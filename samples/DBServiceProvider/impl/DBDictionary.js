"use strict";

var jones            = require("database-jones"),
    DBOperationError = require("./DBOperation").DBOperationError;


/* TableMetadata object represents a table.
   This is the object returned in the getTableMetadata() callback.
   indexes[0] will *ALWAYS* represent the intrinsic primary key.
*/
function TableMetadata() {
  this.database          = "";    // Database name
  this.name              = "";    // Table Name
  this.columns           = [];    // ordered array of ColumnMetadata objects
  this.indexes           = [];    // array of IndexMetadata objects
  this.foreignKeys       = [];    // array of ForeignKeyMetadata objects
  this.partitionKey      = [];    // ordered array of column numbers in the partition key
  this.sparseContainer   = null;  // column name of default sparse fields container
}


/* ColumnMetadata object represents a column.
*/
function ColumnMetadata(isNumeric) {
  /* Required Properties */
  this.name             = ""   ; // column name
  this.columnNumber     = -1   ; // position of column in table; and in columns array
  this.columnType       = ""   ; // column type name, specific to this backend
  this.isIntegral       = false; // true if column is some variety of INTEGER type
  this.isNullable       = false; // true if NULLABLE
  this.isInPrimaryKey   = false; // true if column is part of PK
  this.isInPartitionKey = false; // true if column is part of partition key
  this.defaultValue     = null ; // default value for column= null for default NULL;
                            // undefined for no default; or a type-appropriate
                            // value for column
  
  /* Optional Properties; depending on columnType */
  if(isNumeric) {
    this.isUnsigned       = false;  //  true for UNSIGNED
    this.intSize          = null ;  //  1,2,3,4, or 8 if column type is INT
    this.scale            = 0    ;  //  DECIMAL scale
    this.precision        = 0    ;  //  DECIMAL precision
    this.isAutoincrement  = false;  //  true for AUTO_INCREMENT columns
  }
  else {
    this.length           = 0    ;  //  CHAR or VARCHAR length in characters
    this.isBinary         = false;  //  true for BLOB/BINARY/VARBINARY
    this.charsetName      = ""   ;  //  name of charset
  }
}


/* IndexMetadata represents a table index.  

   The "indexes" array of TableMetadata will hold one or two IndexMetadata 
   records per table index.  For an index that is both unique and ordered; two
   records are created; one with the isUnique flag set; and the other with the 
   isOrdered flag set. 
*/
function IndexMetadata () {
  this.name             = ""    ;  // Index name; undefined for PK
  this.isPrimaryKey     = false ;  // true for PK; otherwise undefined
  this.isUnique         = false ;  // true or false
  this.isOrdered        = false ;  // true or false; can scan if true
  this.columnNumbers    = []    ;  // an ordered array of column numbers
}


/* ForeignKeyMetadata represents a foreign key constraint.  

   The "foreignKeys" array of TableMetadata will hold the foreign key constraints.
    
*/
function ForeignKeyMetadata() {
  this.name              = ""    ;  // Constraint name
  this.columnNames       = []    ;  // an ordered array of column numbers
  this.targetTable       = ""    ;  // referenced table name
  this.targetDatabase    = ""    ;  // referenced database
  this.targetColumnNames = []    ;  // an ordered array of target column names
}


/* createTable() receives an args object created by DBConnectionPool,
   containing members: tableMapping and dbSession.
   It should use TableMapping (including table and field Meta) to create
   an appropriate container table for the mapping.
   The callback should receive (error).
   The DictionaryCall queue guarantees that createTable() will only be called
   once if many users request it simultaneously.
*/
exports.createTable = function(args, userCallback) {
  var error = new DBOperationError().fromSqlState("0A000");
  userCallback(error);
};


/* dropTable() receives an args object created by DBConnectionPool,
   containing members: databaseName, tableName, and dbSession.
   The callback should receive (error).
   The DictionaryCall queue guarantees that getTableMetadata() will only
   be called once if many users request it simultaneously.
*/
exports.dropTable = function(args, userCallback) {
  var error = new DBOperationError().fromSqlState("0A000");
  userCallback(error);
};


/* listTables() receives an args object created by DBConnectionPool,
   containing members: databaseName and dbSession.
   The callback should receive (error, arrayOfTableNames).
   The DictionaryCall queue guarantees that listTables() will only be called
   once if many users request it simultaneously.
*/
exports.listTables = function(args, userCallback) {
  var error = new DBOperationError().fromSqlState("0A000");
  userCallback(error);
};


/* getTableMetadata() receives an args object created by DBConnectionPool,
   containing members: databaseName, tableName, and dbSession.
   The callback should receive (error, tableMetadata).
   The DictionaryCall queue guarantees that getTableMetadata() will only
   be called once if many users request it simultaneously.
*/
exports.getTableMetadata = function(args, userCallback) {
  var error = new DBOperationError().fromSqlState("0A000");
  userCallback(error);
};


/* A MetadataManager is an interpreter for SQL-style CREATE and DROP scripts.
   Its two public functions are createTestTables() and dropTestTables().
*/

function MetadataManager(connectionProperties) {
}


MetadataManager.prototype.createTestTables = function(suiteName, suitePath, userCallback) {
  var error = new DBOperationError().fromSqlState("0A000");
  userCallback(error);
};


MetadataManager.prototype.dropTestTables = function(suiteName, suitePath, userCallback) {
  var error = new DBOperationError().fromSqlState("0A000");
  userCallback(error);
};

exports.getMetadataManager = function(properties) {
  return new MetadataManager(properties);
};



