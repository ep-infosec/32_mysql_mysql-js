/*
 Copyright (c) 2012, 2015, Oracle and/or its affiliates. All rights
 reserved.
 
 This program is free software; you can redistribute it and/or
 modify it under the terms of the GNU General Public License
 as published by the Free Software Foundation; version 2 of
 the License.
 
 This program is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 GNU General Public License for more details.
 
 You should have received a copy of the GNU General Public License
 along with this program; if not, write to the Free Software
 Foundation, Inc., 51 Franklin St, Fifth Floor, Boston, MA
 02110-1301  USA
*/

"use strict";

/* Requires version 2.0 of Felix Geisendoerfer's MySQL client */

var stats = {
  "created"             : 0,
  "list_tables"         : 0,
  "get_table_metadata"  : 0,
  "connections"         : { "successful" : 0, "failed" : 0 }	
};

var mysql = require("mysql");
var jones = require("database-jones");
var mysqlConnection = require("./MySQLConnection.js");
var mysqlDictionary = require("./MySQLDictionary.js");
var udebug = unified_debug.getLogger("MySQLConnectionPool.js");
var util = require('util');
var stats_module = require(jones.api.stats);
var MySQLTime = require(jones.common.MySQLTime);
var SQLBuilder = require(jones.common.SQLBuilder);
var DBTableHandler = require(jones.common.DBTableHandler).DBTableHandler;

stats_module.register(stats, "spi","mysql","DBConnectionPool");

var sqlBuilder = new SQLBuilder();

/* Translate our properties to the driver's */
function getDriverProperties(props) {
  var driver = {};

  if(props.mysql_socket) {
    driver.SocketPath = props.mysql_socket;
  }
  else {
    driver.host = props.mysql_host;
    driver.port = props.mysql_port;
  }

  if(props.mysql_user) {
    driver.user = props.mysql_user;
  }
  if(props.mysql_password) {
    driver.password = props.mysql_password;
  }
  driver.database = props.database;
  driver.debug = props.mysql_debug;
  driver.trace = props.mysql_trace;

  if (props.mysql_charset) {
    driver.charset = props.mysql_charset;
  } else {
    // by default, use utf-8 multibyte for character encoding
    driver.charset = 'UTF8MB4';
  }

  if (props.mysql_sql_mode !== undefined) {
    driver.sql_mode = props.mysql_sql_mode;
  } else {
    // default to STRICT_ALL_TABLES
    driver.sql_mode = 'STRICT_ALL_TABLES';
  }

  // connection pool maximum size
  if (props.mysql_pool_size !== undefined) {
    driver.connectionLimit = props.mysql_pool_size;
    if (props.mysql_pool_queue_size !== 'undefined') {
      driver.queueLimit = props.mysql_pool_queue_size;
    }
  }
  
  // allow multiple statements in one query (used to set character set)
  driver.multipleStatements = true;
  return driver;
}

/** Default domain type converter for timestamp and datetime objects. The domain type is Date
 * and the intermediate type is MySQLTime. MySQLTime provides a lossless conversion from
 * database DATETIME and TIMESTAMP with fractional microseconds. The default domain type converter
 * to javascript Date is lossy: javascript Date does not support microseconds. Users might supply
 * their own domain type with a converter that supports microseconds.
 */
var DomainTypeConverterDateTime = function() {
  // just a bit of documentation for debugging
  this.converter = 'DomainTypeConverterDateTime';
};

DomainTypeConverterDateTime.prototype.toDB = function toDB(userDate) {
  if (userDate === null || userDate === undefined) {
    return userDate;
  }
  // convert to the string form of the mySQLTime object
  var mysqlTime = new MySQLTime();
  mysqlTime.fsp = 6;
  mysqlTime.initializeFromJsDateLocal(userDate);
  return mysqlTime;
};
  
DomainTypeConverterDateTime.prototype.fromDB =  function fromDB(mysqlTime) {
  if (mysqlTime === null || mysqlTime === undefined) {
    return mysqlTime;
  }
  var jsDate = mysqlTime.toJsDateLocal();
  return jsDate;
};

/** Default database type converter for timestamp and datetime objects. The database type is string
 * and the intermediate type is MySQLTime. MySQLTime provides a lossless conversion from
 * database DATETIME and TIMESTAMP with fractional microseconds.
 */
var DatabaseTypeConverterDateTime = function() {
  // just a bit of documentation for debugging
  this.converter = 'DatabaseTypeConverterDateTime';
};

DatabaseTypeConverterDateTime.prototype.toDB = function toDB(mysqlTime) {
  if (typeof mysqlTime !== 'object' || mysqlTime === null) {
    return mysqlTime;
  }
  // convert to the string form of the mySQLTime object
  var dbDateTime = mysqlTime.toDateTimeString();
  return dbDateTime;
};
  
DatabaseTypeConverterDateTime.prototype.fromDB =  function fromDB(dbDateTime) {
  if (dbDateTime === null || dbDateTime === undefined) {
    return dbDateTime;
  }
  var mysqlTime = new MySQLTime();
  mysqlTime.initializeFromDateTimeString(dbDateTime);
  return mysqlTime;
};



/* Constructor saves properties but doesn't actually do anything with them until connect is called.
*/
exports.DBConnectionPool = function(props) {
  this.props = props;
  this.driverproperties = getDriverProperties(props);
  udebug.log('MySQLConnectionPool constructor with driverproperties: ' + util.inspect(this.driverproperties));
  // connections that are being used (wrapped by DBSession)
  this.openConnections = [];
  this.is_connected = false;
  // create database type converter map
  this.databaseTypeConverterMap = {};
  this.databaseTypeConverterMap.TIMESTAMP = new DatabaseTypeConverterDateTime();
  this.databaseTypeConverterMap.DATETIME = new DatabaseTypeConverterDateTime();
  this.databaseTypeConverterMap.JSON = jones.converters.JSONConverter;
  // create domain type converter map
  this.domainTypeConverterMap = {};
  this.domainTypeConverterMap.TIMESTAMP = new DomainTypeConverterDateTime();
  this.domainTypeConverterMap.DATETIME = new DomainTypeConverterDateTime();
  this.pooling = props.mysql_pool_size ? true:false ;
  stats.created++;
};

/* Capabilities provided by this connection.
*/
exports.DBConnectionPool.prototype.getCapabilities = function() {
  return {
    "UniqueIndexes"     : true,   //  Tables can have secondary unique keys
    "TableScans"        : true,   //  Query can scan a table
    "OrderedIndexScans" : true,   //  Query can scan an index
    "ForeignKeys"       : true    //  Named foreign key relationships
  };
};

/** Register a user-specified domain type converter for this connection pool.
 * Called by SessionFactory.registerTypeConverter.
 */
exports.DBConnectionPool.prototype.registerTypeConverter = function(typeName, converterObject) {
  if (converterObject) {
    this.domainTypeConverterMap[typeName] = converterObject;
  } else {
    this.domainTypeConverterMap[typeName] = undefined;
  }
};

/** Get the database type converter for the parameter type name.
 * Called when creating the DBTableHandler for a constructor.
 */
exports.DBConnectionPool.prototype.getDatabaseTypeConverter = function(typeName) {
  return this.databaseTypeConverterMap[typeName];
};

/** Get the domain type converter for the parameter type name.
 * Called when creating the DBTableHandler for a constructor.
 */
exports.DBConnectionPool.prototype.getDomainTypeConverter = function(typeName) {
  return this.domainTypeConverterMap[typeName];
};

/** Get a connection. If pooling via felix, get a connection from the pool.
 * If not, create a connection. This api does not manage the list of open connections.
 * 
 * @param callback (err, connection)
 */
exports.DBConnectionPool.prototype.getConnection = function(callback) {
  var connectionPool = this;
  var connection, error;

  function getConnectionOnConnection(err, c) {
    udebug.log('getConnectionOnConnection');
    if (err) {
      stats.connections.failed++;
      // create a new Error with a message and this stack
      error = new Error('Connection failed.');
      // add cause to the error
      error.cause = err;
      // add sqlstate to error
      error.sqlstate = '08000';
      callback(error);      
    } else {
      stats.connections.successful++;
      if (connectionPool.pooling) {
        // some older versions of node-mysql do not have release()
        if(typeof c.release !== 'function') { c.release = c.end; }
        callback(null, c);
      } else {
        callback(null, connection);
      }
    }
  }

  // getConnection starts here
  if (connectionPool.pooling) {
    // get a connection from the felix pool
    udebug.log('getConnection using connection pooling: true');
    connectionPool.pool.getConnection(getConnectionOnConnection);
  } else if (connectionPool.is_connected || connectionPool.is_connecting) {
    // create a new connection
    udebug.log('getConnection using connection pooling: false');
    connection = mysql.createConnection(connectionPool.driverproperties);
    connection.connect(getConnectionOnConnection);
  } else {
    // error
    callback(new Error('getConnection called before connect.'));
  }
};

/** Release a connection (synchronous). If pooling via felix, return the connection to the pool.
 * If not, end the connection. No errors are reported to the user.
 */
exports.DBConnectionPool.prototype.releaseConnection = function(connection) {
  var connectionPool = this;
  if (connectionPool.pooling) {
    udebug.log('releaseConnection using connection pooling: true');
    connection.release();
  } else {
    udebug.log('releaseConnection using connection pooling: false');
    connection.end();
  }
};

/** Connect to the database. Verify connection properties.
 * @param user_callback (err, connectionPool)
 */
exports.DBConnectionPool.prototype.connect = function(callback) {
  var connectionPool = this;
  var error;

  function connectOnConnection(err, connection) {
    connectionPool.is_connecting = false;
    if (err) {
      stats.connections.failed++;
      // create a new Error with a message and this stack
      error = new Error('Connection to MySQL server failed.\n' +
          'Your connection properties have been translated into node-mysql connection options:\n' +
          'https://github.com/felixge/node-mysql/#connection-options\n' +
          util.inspect(connectionPool.driverproperties));
      // add cause to the error
      error.cause = err;
      // add sqlstate to error
      error.sqlstate = '08000';
      callback(error);
    } else {
      stats.connections.successful++;
      connectionPool.is_connected = true;
      connectionPool.releaseConnection(connection);
      callback(null, connectionPool);
    }
  }

  // connect begins here
  if (connectionPool.is_connected) {
    udebug.log('MySQLConnectionPool.connect is already connected');
    callback(null, connectionPool);
  } else {
    connectionPool.is_connecting = true;
    if (connectionPool.pooling) {
      connectionPool.pool = mysql.createPool(connectionPool.driverproperties);
    }
    // verify that the connection properties work by getting a connection
    connectionPool.getConnection(connectOnConnection);
  }
};

exports.DBConnectionPool.prototype.close = function(user_callback) {
  var connectionPool = this;
  udebug.log('close');
  var i, openConnection;
  for (i = 0; i < this.openConnections.length; ++i) {
    openConnection = this.openConnections[i];
    udebug.log('close ending open connection', i);
    if (openConnection && openConnection._connectCalled) {
      connectionPool.releaseConnection(openConnection);
    }
  }
  this.openConnections = [];
  this.is_connected = false;

  // end the underlying connection pool (close all connections gracefully)
  connectionPool.pool.end(function(err) {
    user_callback(err);
  });
};

exports.DBConnectionPool.prototype.destroy = function() { 
};

exports.DBConnectionPool.prototype.isConnected = function() {
  return this.is_connected;
};

var countOpenConnections = function(connectionPool) {
  var i, count = 0;
  for (i = 0; i < connectionPool.openConnections.length; ++i) {
    if (connectionPool.openConnections[i] !== null) {
      count++;
    }
  }
  return count;
};

exports.DBConnectionPool.prototype.getDBSession = function(index, callback) {
  var connectionPool = this;
  var newDBSession = null;
  var charset = connectionPool.driverproperties.charset;
  var charsetQuery = 
       'SET character_set_client=\'' + charset +
    '\';SET character_set_connection=\'' + charset +
    '\';SET character_set_results=\'' + charset + 
    '\';';
  var sqlModeQuery = '';
  // set SQL_MODE if specified in driverproperties
  if (connectionPool.driverproperties.sql_mode !== undefined) {
    sqlModeQuery = 'SET SQL_MODE = \'' + connectionPool.driverproperties.sql_mode + '\';';
  }
  udebug.log(sqlModeQuery);
  function charsetComplete(err) {
    callback(err, newDBSession);
  }
    var connected_callback = function(err, pooledConnection) {
      if (err) {
        callback(err);
        return;
      }
      newDBSession = new mysqlConnection.DBSession(pooledConnection, connectionPool, index);
      connectionPool.openConnections[index] = pooledConnection;
      udebug.log_detail('MySQLConnectionPool.getDBSession created a new pooledConnection for index ' + index + ' ; ', 
          ' openConnections: ', countOpenConnections(connectionPool));
      // set character set server variables      
      pooledConnection.query(charsetQuery + sqlModeQuery, charsetComplete);
    };
    // create a new connection
    connectionPool.getConnection(connected_callback);
};

/** Close the connection being used by the dbSession.
 * @param dbSession contains index the index into the openConnections array
 *                           pooledConnection the connection being used
 * @param callback when the connection is closed call the user
 */
exports.DBConnectionPool.prototype.closeConnection = function(dbSession, callback) {
  var connectionPool = this;
  if (dbSession.pooledConnection) {
    connectionPool.releaseConnection(dbSession.pooledConnection);
    dbSession.pooledConnection = null;
  }
  connectionPool.openConnections[dbSession.index] = null;
  if (typeof callback === 'function') {
    callback(null);
  }
};

exports.DBConnectionPool.prototype.getTableMetadata = function(databaseName, tableName, dbSession, user_callback) {
  var connectionPool = this;
  var connection, dictionary;
  stats.get_table_metadata++;

  function getTableMetadataOnMetadata(err, metadata) {
    if (!dbSession) {
      connectionPool.releaseConnection(connection);
    }
    user_callback(err, metadata);
  }

  function getTableMetadataOnConnection(err, c) {
    if (err) {
      user_callback(err);
    } else {
      connection = c;
      dictionary = new mysqlDictionary.DataDictionary(connection, connectionPool);
      udebug.log_detail('MySQLConnectionPool.getTableMetadata calling dictionary.getTableMetadata for',
          databaseName, tableName);
      dictionary.getTableMetadata(databaseName, tableName, getTableMetadataOnMetadata);
    }
  }

  // getTableMetadata starts here

  if (dbSession) {
    // dbSession exists; use the connection in the db session
    getTableMetadataOnConnection(null, dbSession.pooledConnection);
  } else {
    // dbSession does not exist; get a connection for the call
    connectionPool.getConnection(getTableMetadataOnConnection);
  }

};

exports.DBConnectionPool.prototype.listTables = function(databaseName, dbSession, user_callback) {

  var connectionPool = this;
  var connection, dictionary;
  stats.list_tables++;

  function listTablesOnTableList(err, list) {
    if (!dbSession) {
      // return the connection we got just for this call
      connectionPool.releaseConnection(connection);
    }
    // return the list to the user
    user_callback(err, list);
  }

  function listTablesOnConnection(err, c) {
    if (err) {
      user_callback(err);
    } else {
      connection = c;
      dictionary = new mysqlDictionary.DataDictionary(connection);
      dictionary.listTables(databaseName, listTablesOnTableList);
    }
  }

  // listTables starts here
  
  if (dbSession) {
    listTablesOnConnection(null, dbSession.pooledConnection);
  } else {
    // dbSession does not exist; get a connection for the call
    connectionPool.getConnection(listTablesOnConnection);
  }
};

/** Create the table in the database for the mapping.
 * @param tableMapping the mapping for this table
 * @param session the session to use for database operations
 * @param user_callback the user callback(err)
 * @return err if any errors
 *
 * Side effect: if TableMapping.database is not set, createTable() sets it 
 * to the default database
 */
exports.DBConnectionPool.prototype.createTable = function(tableMapping, session, user_callback) {
  var engine = this.props.mysql_storage_engine;
  var connectionPool = this;
  var connection;

  function createTableOnQuery(err) {
     if (!session || !session.dbSession) {
      // return the connection we got just for this call
      connectionPool.releaseConnection(connection);
    }
    user_callback(err);
  }

  function createTableOnConnection(err, c) {
    var createTableSQL;
    if (err) {
      user_callback(err);
    } else {
      connection = c;
      createTableSQL = sqlBuilder.getSqlForTableCreation(tableMapping, engine);
      connection.query(createTableSQL, createTableOnQuery);
    }
  }

  // createTable starts here
  udebug.log('createTable for tableMapping:', tableMapping);
  if(! tableMapping.database) {
    tableMapping.database = this.driverproperties.database;
  }
  if (session && session.dbSession) {
    // dbSession exists; use the connection in the db session
    createTableOnConnection(null, session.dbSession.pooledConnection);
  } else {
    // dbSession does not exist; get a connection for the call
    this.getConnection(createTableOnConnection);
  }
};


exports.DBConnectionPool.prototype.dropTable = function(dbName, tableName, session, user_callback) {
  var connectionPool, connection, qualifiedName;
  connectionPool = this;

  function dropTableOnQuery(err) {
     if (!session || !session.dbSession) {
       // return the connection we got just for this call
       connectionPool.releaseConnection(connection);
    }
    user_callback(err);
  }

  function dropTableOnConnection(err, c) {
    if(err) {
      user_callback(err);
    } else {
      connection = c;
      connection.query("DROP TABLE IF EXISTS " + qualifiedName, dropTableOnQuery);
    }
  }

  // dropTable starts here
  qualifiedName = dbName + "." + tableName;
  udebug.log('dropTable for ', qualifiedName);
  if(session && session.dbSession) {
    dropTableOnConnection(null, session.dbSession.pooledConnection);
  } else {
    this.getConnection(dropTableOnConnection);
  }
};

