/*
 Copyright (c) 2012, 2016, Oracle and/or its affiliates. All rights
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

var        util    = require("util");
var       jones    = require("database-jones");
var     BitMask    = require(jones.common.BitMask);
var      udebug    = unified_debug.getLogger("Query.js");
var userContext    = require("./UserContext.js");

var keywords = ['param', 'where', 'field', 'execute'];

var QueryParameter;
var QueryHandler;
var QueryEq, QueryNe, QueryLe, QueryLt, QueryGe, QueryGt, QueryBetween, QueryIn, QueryIsNull, QueryIsNotNull;
var QueryNot, QueryAnd, QueryOr;

/** QueryDomainType function param */
var param = function(name) {
  return new QueryParameter(this, name);
};

/** QueryDomainType function where */
var where = function(predicate) {
  var jones = this.jones_query_domain_type;
  jones.predicate = predicate;
  jones.queryHandler = new QueryHandler(jones.dbTableHandler, predicate);
  jones.queryType = jones.queryHandler.queryType;
  return this;
};

/** QueryDomainType function execute */
var execute = function(queryParameters, callback) {
	// if no where function, use the default (table scan)
	if (this.jones_query_domain_type.queryHandler === undefined) {
		this.jones_query_domain_type.queryHandler = new QueryHandler(this.jones_query_domain_type.dbTableHandler);
	}
  var session = this.jones_query_domain_type.session;
  var context = new userContext.UserContext(arguments, 2, 2, session, session.sessionFactory);
  // if the user did not specify any arguments, default queryParameters to {}
  context.user_arguments[0] = queryParameters || {};
  // delegate to context's execute for execution
  return context.executeQuery(this);
};

var queryDomainTypeFunctions = {};
queryDomainTypeFunctions.where = where;
queryDomainTypeFunctions.param = param;
queryDomainTypeFunctions.execute = execute;

/**
 * QueryField represents a mapped field in a domain object. It encapsulates a FieldMapping
 * and the table alias used to generate SQL based on which sector the field is in.
 * QueryField is used to build QueryPredicates by comparing the field to parameters.
 * @param queryDomainType the query domain type returned by session.createQuery callback
 * @param field the FieldMapping (component of TableMapping) for the field
 * @param aliasIndex the sector number where this field is defined
 */
function QueryField (queryDomainType, field, aliasIndex) {
  udebug.log('QueryField<ctor>', field.fieldName, 'aliasIndex', aliasIndex);
//  this.class = 'QueryField';        // useful for debugging
//  this.fieldName = field.fieldName; // useful for debugging
  this.queryDomainType = queryDomainType;
  this.field = field;
  this.columnName = field.columnName;
  this.alias = aliasIndex !== undefined ?('t' + aliasIndex + '.'): '';
}

QueryField.prototype.eq = function(queryParameter) {
  return new QueryEq(this, queryParameter);
};

QueryField.prototype.le = function(queryParameter) {
  return new QueryLe(this, queryParameter);
};

QueryField.prototype.ge = function(queryParameter) {
  return new QueryGe(this, queryParameter);
};

QueryField.prototype.lt = function(queryParameter) {
  return new QueryLt(this, queryParameter);
};

QueryField.prototype.gt = function(queryParameter) {
  return new QueryGt(this, queryParameter);
};

QueryField.prototype.ne = function(queryParameter) {
  return new QueryNe(this, queryParameter);
};

QueryField.prototype.between = function(queryParameter1, queryParameter2) {
  return new QueryBetween(this, queryParameter1, queryParameter2);
};

// 'in' is a keyword so use alternate syntax
QueryField.prototype['in'] = function(queryParameter) {
  return new QueryIn(this, queryParameter);
};

QueryField.prototype.isNull = function() {
  return new QueryIsNull(this);
};

QueryField.prototype.isNotNull = function() {
  return new QueryIsNotNull(this);
};

QueryField.prototype[util.inspect.custom] = function(depth, options) {
  return this.field.fieldName;
};

/** Make the field queryable even if the name of the field is a reserved word.
 * @param qdt the QueryDomainType or QueryRelationship to assign the queryableField
 * @param name the name of the field
 * @param queryableField the QueryField or QueryRelationship to assign qdt[name]
 */
function makeQueryable(qdt, name, queryableField) {
  if (keywords.indexOf(name) === -1) {
    // field name is not a keyword
    qdt[name] = queryableField;
  } else {
    if(udebug.is_detail()) {udebug.log_detail('QueryProjectionDomainType<ctor> field', name, 'is a keyword.');}
    // field name is a keyword
    // allow e.g. qdt.where.id
    if (name !== 'field') {
      // if field is a reserved word but not a function, skip setting the function
      qdt[name] = queryDomainTypeFunctions[name];
      qdt[name].eq = QueryField.prototype.eq;
      qdt[name].field = queryableField.field;
    }
    // allow e.g. qdt.field.where
    qdt.field[name] = queryableField;
  }
}


/**
 * QueryRelationship represents a mapped relationship in a domain object.
 * QueryRelationship is used to build QueryPredicates by navigating the
 * relationship to fields.
 * @param sectors the sector array from the top level projection
 * @param childSectorIndex the index into sectors for this relationship
 * @param childRelationshipName the name of the field in the parent
 */
function QueryRelationship(sectors, childSectorIndex, childRelationshipName) {
	var projection = sectors[childSectorIndex].projection;
  udebug.log('QueryRelationship<ctor> for ', childRelationshipName, 'index', childSectorIndex);
  if(udebug.is_detail()) { udebug.log_detail('with projection', projection); }
  this.alias = 't' + childSectorIndex + '.';
  this.columnName = childRelationshipName;
  // get the name of the first primary key field for isNull and isNotNull operations
  var dbTableHandler = projection.dbTableHandler;
  var dbTable = projection.dbTableHandler.dbTable;
  var primaryKeyIndex = projection.dbTableHandler.dbTable.indexes[0];
  var primaryKeyIndexColumnNumber = primaryKeyIndex.columnNumbers[0];
  var primaryKeyName = dbTable.columns[primaryKeyIndexColumnNumber].name;
  // get FieldMapping for the first primary key field
  this.field = dbTableHandler.getFieldMapping(primaryKeyName);
}

QueryRelationship.prototype.isNull = function() {
  return new QueryIsNull(this);
};

QueryRelationship.prototype.isNotNull = function() {
  return new QueryIsNotNull(this);
};

QueryRelationship.prototype.eq = function() {
  throw new Error('illegal operation eq for relationship ' + this.field.fieldName);
};

QueryRelationship.prototype.le = function() {
  throw new Error('illegal operation le for relationship ' + this.field.fieldName);
};

QueryRelationship.prototype.ge = function() {
  throw new Error('illegal operation ge for relationship ' + this.field.fieldName);
};

QueryRelationship.prototype.lt = function() {
  throw new Error('illegal operation lt for relationship ' + this.field.fieldName);
};

QueryRelationship.prototype.gt = function() {
  throw new Error('illegal operation gt for relationship ' + this.field.fieldName);
};

QueryRelationship.prototype.ne = function() {
  throw new Error('illegal operation ne for relationship ' + this.field.fieldName);
};

QueryRelationship.prototype.between = function() {
  throw new Error('illegal operation between for relationship ' + this.field.fieldName);
};

QueryRelationship.prototype['in'] = function() {
  throw new Error('illegal operation in for relationship ' + this.field.fieldName);
};

QueryRelationship.prototype[util.inspect.custom] = function(depth, options) {
  return this.field.fieldName;
};


/** QueryProjectionDomainType represents a projection that can be used to create and execute queries.
 * It encapsulates the Projection which contains references to the domain type, fields, and relationships.
 * This object differs from QueryDomainType in that relationships are included in the fields of the object
 * so that relationships can also be queried.
 * @param session the user Session
 * @param projection the Projection
 */
function QueryProjectionDomainType(session, projection) {
  var dbTableHandler;
  this.queryDomainType = null;
  this.isQueryProjectionDomainType = true;
  this.projection = projection;
  udebug.log('QueryProjectionDomainType<ctor> for', projection.domainObject.name,'\nsectors:', projection.sectors);
  if(udebug.is_detail()) {udebug.log_detail('projection', projection);}
  // get the dbTableHandler for the list of query-able fields
  dbTableHandler = projection.dbTableHandler;
  // the projection also has query-able relationship fields
  // avoid most name conflicts: put all implementation artifacts into the property jones_query_domain_type
  this.jones_query_domain_type = {};
  this.field = {};
  this.prototype = {};
  var jones = this.jones_query_domain_type;
  jones.session = session;
  jones.dbTableHandler = dbTableHandler;
  jones.domainObject = true;
  jones.queryType = 3; // default is table scan
  var queryDomainType = this;
  // initialize the functions (may be overridden below if a field has the name of a keyword)
  queryDomainType.where = where;
  queryDomainType.param = param;
  queryDomainType.execute = execute;

  /** Make the field queryable even if the name of the field is a reserved word.
   * @param qdt the QueryDomainType or QueryField to assign the queryableField
   * @param name the name of the field
   * @param queryableField the QueryField (or QueryRelationship) to assign to qdt[name]
   */
  function makeQueryable(qdt, name, queryableField) {
    if (keywords.indexOf(name) === -1) {
      // field name is not a keyword
      qdt[name] = queryableField;
    } else {
      if(udebug.is_detail()) {udebug.log_detail('QueryProjectionDomainType<ctor> field', name, 'is a keyword.');}
      // field name is a keyword
      // allow e.g. qdt.where.id
      if (name !== 'field') {
        // if field is a reserved word but not a function, skip setting the function
        qdt[name] = queryDomainTypeFunctions[name];
        qdt[name].eq = QueryField.prototype.eq;
        qdt[name].field = queryableField.field;
      }
      // allow e.g. qdt.field.where
      qdt.field[name] = queryableField;
    }
  }

  /** Create a QueryField for a Sector. For each projection field at the top level,
   * a QueryField is created, using the sector index as a parameter for the QueryField.
   * For each relationship at the top level, a QueryRelationship is created.
   * The QueryRelationship then creates QueryFields and recursively, QueryRelationships
   * for its own relationships.
   * @param qdt the QueryDomainType or QueryRelationship to assign the QueryFields and QueryRelationships
   * @param sectors the array of sectors at the top level
   * @param index the index into the sectors for which to create the QueryFields
   */
  function createQueryFieldsAndRelationships(qdt, sectors, index) {
    var sector, sectorProjection, sectorDBTableHandler, sectorFieldMapping, queryField;
    var childSector, childRelationshipName;
    // get the sector
    sector = sectors[index];
    // get the projection for this sector
    sectorProjection = sector.projection;
    // get the dbTableHandler for this sector
    sectorDBTableHandler = sectorProjection.dbTableHandler;
    udebug.log('createQueryFieldsAndRelationships for sector', index, 'name', sectorProjection.domainObject.name);
    // for each projected field, assign the QueryField to this QueryDomainType
    sectorProjection.fields.forEach(function(name) {
      // get the field mapping for each field name
      sectorFieldMapping = sectorDBTableHandler.getFieldMapping(name);
      // create the QueryField for the field in this sector
      queryField = new QueryField(qdt, sectorFieldMapping, index);
      makeQueryable(qdt, name, queryField);
    });
    // for each projected relationship, create the QueryRelationship and assign it to this QueryDomainType or QueryRelationship
    sector.childSectorIndexes.forEach(function(childSectorIndex) {
      // get the relationship name
      childSector = sectors[childSectorIndex];
      childRelationshipName = childSector.parentFieldMapping.fieldName;
      queryField = new QueryRelationship(sectors, childSectorIndex, childRelationshipName);
      makeQueryable(qdt, childRelationshipName, queryField);
      // recursively create QueryRelationships and their QueryFields
      createQueryFieldsAndRelationships(queryField, projection.sectors, childSectorIndex);
    });
  }

  // create the top QueryFields and QueryRelationships
  createQueryFieldsAndRelationships(queryDomainType, projection.sectors, 0);

}

/** Query Domain Type represents a domain object that can be used to create and execute queries.
 * It encapsulates the dbTableHandler (obtained from the domain object or table name),
 * the session (required to execute the query), and the filter which limits the result.
 * @param session the user Session
 * @param dbTableHandler the dbTableHandler
 * @param domainObject true if the query results are domain objects
 */
var QueryDomainType = function(session, dbTableHandler, domainObject) {
  udebug.log('QueryDomainType<ctor>', dbTableHandler.dbTable.name);
  // avoid most name conflicts: put all implementation artifacts into the property jones_query_domain_type
  this.jones_query_domain_type = {};
  this.field = {};
  this.prototype = {};
  var jones = this.jones_query_domain_type;
  jones.session = session;
  jones.dbTableHandler = dbTableHandler;
  jones.domainObject = domainObject;
  jones.queryType = 3; // default is table scan
  var queryDomainType = this;
  // initialize the functions (may be overridden below if a field has the name of a keyword)
  queryDomainType.where = where;
  queryDomainType.param = param;
  queryDomainType.execute = execute;
  
  var fieldName, queryField;
  // add a property for each field in the table mapping
  jones.dbTableHandler.getAllQueryFields().forEach(function(field) {
    fieldName = field.fieldName;
    queryField = new QueryField(queryDomainType, field);
    if (keywords.indexOf(fieldName) === -1) {
      // field name is not a keyword
      queryDomainType[fieldName] = queryField;
    } else {
      if(udebug.is_detail()) {udebug.log_detail('QueryDomainType<ctor> field', fieldName, 'is a keyword.');}
      // field name is a keyword
      // allow e.g. qdt.where.id
      if (fieldName !== 'field') {
        // if field is a reserved word but not a function, skip setting the function
        queryDomainType[fieldName] = queryDomainTypeFunctions[fieldName];
        queryDomainType[fieldName].eq = QueryField.prototype.eq;
        queryDomainType[fieldName].field = queryField.field;
      }
      // allow e.g. qdt.field.where
      queryDomainType.field[fieldName] = queryField;
    }
  });
};

// give QueryProjectionDomainType the same behavior as QueryDomainType
QueryProjectionDomainType.prototype = QueryDomainType.prototype;

QueryDomainType.prototype[util.inspect.custom] = function(depth, options) {
  var jones = this.jones_query_domain_type;
  return "[[API Query on table: " + jones.dbTableHandler.dbTable.name + 
    ", type: " + jones.queryType + ", predicate: " + 
    util.inspect(jones.predicate) + "]]\n";
};

QueryDomainType.prototype.not = function(queryPredicate) {
  return new QueryNot(queryPredicate);
};

/**
 * QueryParameter represents a named parameter for a query. The QueryParameter marker is used
 * as the comparand for QueryField.
 * @param queryDomainType
 * @param name
 * @return
 */
QueryParameter = function QueryParameter(queryDomainType, name) {
  if(udebug.is_detail()) {udebug.log_detail('QueryParameter<ctor>', name);}
  this.queryDomainType = queryDomainType;
  this.name = name;
};

QueryParameter.prototype[util.inspect.custom] = function(depth, options) {
  return '?' + this.name;
};

/******************************************************************************
 *                 SQL VISITOR
 *****************************************************************************/
var SQLVisitor = function(rootPredicateNode) {
  this.rootPredicateNode = rootPredicateNode;
  rootPredicateNode.sql = {};
  rootPredicateNode.sql.formalParameters = [];
  rootPredicateNode.sql.sqlText = 'initialized';
  this.parameterIndex = 0;
};

function isQueryParameter(parameter) {
  return typeof parameter === 'object'
    && parameter.constructor
    && parameter.constructor.name === 'QueryParameter';
}

function getEscapedValue(literal) {
  var ret = literal.toString();
  if (typeof literal === 'string') {
    ret = '\'' + literal + '\'';
  }
  return ret;
}

/** Handle nodes QueryEq, QueryNe, QueryLt, QueryLe, QueryGt, QueryGe */
SQLVisitor.prototype.visitQueryComparator = function(node) {
  // set up the sql text in the node
  var columnName = node.queryField.alias + node.queryField.columnName;
  var value = '?';
  if(node.constants) {
    // the parameter is a literal (String, number, or object with a toString method)
    value = getEscapedValue(node.parameter);
  } else {
    this.rootPredicateNode.sql.formalParameters[this.parameterIndex++] = node.parameter;
  }
  node.sql.sqlText = columnName + node.comparator + value;
  udebug.log('SQLVisitor for', node.queryField.field.fieldName + node.comparator);
  if(udebug.is_detail()) {udebug.log_detail(node.sql.sqlText);}
  // assign ordered list of parameters to the top node
};

/** Handle nodes QueryAnd, QueryOr */
SQLVisitor.prototype.visitQueryNaryPredicate = function(node) {
  var i;
  // all n-ary predicates have at least two
  node.predicates[0].visit(this); // sets up the sql.sqlText in the node
  node.sql.sqlText = '(' + node.predicates[0].sql.sqlText + ')';
  for (i = 1; i < node.predicates.length; ++i) {
    node.sql.sqlText += node.operator;
    node.predicates[i].visit(this);
    node.sql.sqlText += '(' + node.predicates[i].sql.sqlText + ')';
  }
};

/** Handle nodes QueryNot */
SQLVisitor.prototype.visitQueryUnaryPredicate = function(node) {
  node.predicates[0].visit(this); // sets up the sql.sqlText in the node
  node.sql.sqlText = node.operator + '(' + node.predicates[0].sql.sqlText + ')';
};

/** Handle nodes QueryIsNull, QueryIsNotNull */
SQLVisitor.prototype.visitQueryUnaryOperator = function(node) {
  var columnName = node.queryField.alias + node.queryField.field.columnName;
  node.sql.sqlText = columnName + node.operator;
  udebug.log('SQLVisitor for', node.queryField.field.fieldName + node.operator);
  if(udebug.is_detail()) {udebug.log_detail(node.sql.sqlText);}
};

/** Handle node QueryBetween */
SQLVisitor.prototype.visitQueryBetweenOperator = function(node) {
  var columnName = node.queryField.alias + node.queryField.field.columnName;
  var leftValue = '?';
  var rightValue = '?';
  if (node.constants & 1) {
    leftValue = getEscapedValue(node.parameter1);
  } else {
    this.rootPredicateNode.sql.formalParameters[this.parameterIndex++] = node.formalParameters[0];
  }
  if (node.constants & 2) {
    rightValue = getEscapedValue(node.parameter2);
  } else {
    this.rootPredicateNode.sql.formalParameters[this.parameterIndex++] = node.formalParameters[1];
  }
  node.sql.sqlText = columnName + ' BETWEEN ' + leftValue + ' AND ' + rightValue;
  udebug.log('SQLVisitor for', node.queryField.field.fieldName + node.comparator);
  if(udebug.is_detail()) {udebug.log_detail(node.sql.sqlText);}
};

/******************************************************************************
 *                 MARKS COLUMN MASKS IN QUERY NODES
 *****************************************************************************/
function MaskMarkerVisitor() {
}

/** Set column number in usedColumnMask */
function markUsed(node) {
  node.usedColumnMask = new BitMask(); 
  node.equalColumnMask = new BitMask();
  node.usedColumnMask.set(node.queryField.field.columnNumber);
}

/** Handle nodes QueryEq, QueryNe, QueryLt, QueryLe, QueryGt, QueryGe */
MaskMarkerVisitor.prototype.visitQueryComparator = function(node) {
  markUsed(node);
  if(node.operationCode === 4) {  // QueryEq
    node.equalColumnMask.set(node.queryField.field.columnNumber);
  }
};

/** Nodes Between, IsNotNull, IsNotNull are all handled by markUsed() */
MaskMarkerVisitor.prototype.visitQueryUnaryOperator = markUsed;
MaskMarkerVisitor.prototype.visitQueryBetweenOperator = markUsed;

/** Handle QueryNot */
MaskMarkerVisitor.prototype.visitQueryUnaryPredicate = function(node) {
  node.predicates[0].visit(this);
  node.equalColumnMask = new BitMask();  // Set to zero 
  node.usedColumnMask  = node.predicates[0].usedColumnMask;
};

/** Handle nodes QueryAnd, QueryOr */
MaskMarkerVisitor.prototype.visitQueryNaryPredicate = function(node) {
  var i;
  node.usedColumnMask = new BitMask(); 
  node.equalColumnMask = new BitMask();
  for(i = 0 ; i < node.predicates.length ; i++) {
    node.predicates[i].visit(this);
    node.usedColumnMask.orWith(node.predicates[i].usedColumnMask);
    if(this.operationCode === 1) {  // QueryAnd
      node.equalColumnMask.orWith(node.predicates[i].equalColumnMask);
    }
  }
};

var theMaskMarkerVisitor = new MaskMarkerVisitor();   // Singleton

/******************************************************************************
 *                 MARKS CONSTANT EXPRESSIONS
 *****************************************************************************/
function ConstMarkerVisitor() {
}

/** Handle nodes QueryAnd, QueryOr */
ConstMarkerVisitor.prototype.visitQueryNaryPredicate = function(node) {
  var i;
  for(i = 0 ; i < node.predicates.length ; i++) {
    node.predicates[i].visit(this);
    if(node.predicates[i].constants) {
      node.constants = 1;
    }
  }
};

/** Handle QueryNot */
ConstMarkerVisitor.prototype.visitQueryUnaryPredicate = function(node) {
  node.predicates[0].visit(this);
  if(node.predicates[0].constants) {
    node.constants = 1;
  }
};

/** Handle nodes QueryEq, QueryNe, QueryLt, QueryLe, QueryGt, QueryGe */
ConstMarkerVisitor.prototype.visitQueryComparator = function(node) {
  if (! isQueryParameter(node.parameter)) {
    node.constants = 1;
  }
};

/** Handle node QueryBetween */
ConstMarkerVisitor.prototype.visitQueryBetweenOperator = function(node) {
  if (! isQueryParameter(node.parameter1)) {
    node.constants = 1;
  }
  if (! isQueryParameter(node.parameter2)) {
    node.constants += 2;
  }
};

var theConstMarkerVisitor =  new ConstMarkerVisitor();  // Singleton

/******************************************************************************
 *                 TOP LEVEL ABSTRACT QUERY PREDICATE
 *****************************************************************************/
var AbstractQueryPredicate = function() {
  this.sql = {};
  this.constants = 0;
};

AbstractQueryPredicate.prototype[util.inspect.custom] = function(depth, opt) {
  var str = this.operator + "(";
  this.predicates.forEach(function(value,index) { 
    if(index) {str += " , ";}
    str += value.inspect();
  });
  str += ")";
  return str;
};

AbstractQueryPredicate.prototype.and = function(predicate) {
  // TODO validate parameter
  return new QueryAnd(this, predicate);
};

AbstractQueryPredicate.prototype.andNot = function(predicate) {
  // TODO validate parameter
  return new QueryAnd(this, new QueryNot(predicate));
};

AbstractQueryPredicate.prototype.or = function(predicate) {
  // TODO validate parameter for OR
  return new QueryOr(this, predicate);
};

AbstractQueryPredicate.prototype.orNot = function(predicate) {
  // TODO validate parameter
  return new QueryOr(this, new QueryNot(predicate));
};

AbstractQueryPredicate.prototype.not = function() {
  // TODO validate parameter
  return new QueryNot(this);
};

AbstractQueryPredicate.prototype.getTopLevelPredicates = function() {
  return [this];
};

AbstractQueryPredicate.prototype.getSQL = function() {
  var visitor = new SQLVisitor(this);
  this.visit(visitor);
  return this.sql;
};

/******************************************************************************
 *                 ABSTRACT QUERY N-ARY PREDICATE
 *                          AND and OR
 *****************************************************************************/
var AbstractQueryNaryPredicate = function() {
};

AbstractQueryNaryPredicate.prototype = new AbstractQueryPredicate();

AbstractQueryNaryPredicate.prototype.getTopLevelPredicates = function() {
  return this.predicates;
};

AbstractQueryNaryPredicate.prototype.visit = function(visitor) {
  if (typeof(visitor.visitQueryNaryPredicate) === 'function') {
    visitor.visitQueryNaryPredicate(this);
  }
};

/******************************************************************************
 *                 ABSTRACT QUERY UNARY PREDICATE
 *                           NOT
 *****************************************************************************/
var AbstractQueryUnaryPredicate = function() {
};

AbstractQueryUnaryPredicate.prototype = new AbstractQueryPredicate();

AbstractQueryUnaryPredicate.prototype.visit = function(visitor) {
  if (typeof(visitor.visitQueryUnaryPredicate) === 'function') {
    visitor.visitQueryUnaryPredicate(this);
  }
};

/******************************************************************************
 *                 ABSTRACT QUERY COMPARATOR
 *                  eq, ne, gt, lt, ge, le
 *****************************************************************************/
var AbstractQueryComparator = function() {
};

/** AbstractQueryComparator inherits AbstractQueryPredicate */
AbstractQueryComparator.prototype = new AbstractQueryPredicate();

AbstractQueryComparator.prototype[util.inspect.custom] = function() {
  var parameterValue = this.parameter;
  if (typeof this.parameter === 'object' && this.parameter.constructor.name == 'QueryParameter') {
    parameterValue = this.parameter.inspect();
  }
  return this.queryField.field.fieldName + this.comparator + parameterValue;
};

AbstractQueryComparator.prototype.visit = function(visitor) {
  if (typeof(visitor.visitQueryComparator) === 'function') {
    visitor.visitQueryComparator(this);
  }
};

/******************************************************************************
 *                 QUERY EQUAL
 *****************************************************************************/
QueryEq = function(queryField, parameter) {
  this.comparator = ' = ';
  this.operationCode = 4;
  this.queryField = queryField;
  this.parameter = parameter;
};

QueryEq.prototype = new AbstractQueryComparator();

/******************************************************************************
 *                 QUERY LESS THAN OR EQUAL
 *****************************************************************************/
QueryLe = function(queryField, parameter) {
  this.comparator = ' <= ';
  this.operationCode = 0;
  this.queryField = queryField;
  this.parameter = parameter;
};

QueryLe.prototype = new AbstractQueryComparator();

/******************************************************************************
 *                 QUERY GREATER THAN OR EQUAL
 *****************************************************************************/
QueryGe = function(queryField, parameter) {
  this.comparator = ' >= ';
  this.operationCode = 2;
  this.queryField = queryField;
  this.parameter = parameter;
};

QueryGe.prototype = new AbstractQueryComparator();

/******************************************************************************
 *                 QUERY LESS THAN
 *****************************************************************************/
QueryLt = function(queryField, parameter) {
  this.comparator = ' < ';
  this.operationCode = 1;
  this.queryField = queryField;
  this.parameter = parameter;
};

QueryLt.prototype = new AbstractQueryComparator();

/******************************************************************************
 *                 QUERY GREATER THAN
 *****************************************************************************/
QueryGt = function(queryField, parameter) {
  this.comparator = ' > ';
  this.operationCode = 3;
  this.queryField = queryField;
  this.parameter = parameter;
};

QueryGt.prototype = new AbstractQueryComparator();

/******************************************************************************
 *                 QUERY BETWEEN
 *****************************************************************************/
QueryBetween = function(queryField, parameter1, parameter2) {
  this.comparator = ' BETWEEN ';
  this.queryField = queryField;
  this.formalParameters = [];
  this.formalParameters[0] = parameter1;
  this.formalParameters[1] = parameter2;
  this.parameter1 = parameter1;
  this.parameter2 = parameter2;
};

QueryBetween.prototype = new AbstractQueryComparator();

QueryBetween.prototype[util.inspect.custom] = function() {
  var parameterValue1 = this.parameter1;
  var parameterValue2 = this.parameter2;
  if (typeof this.parameter1 === 'object' && this.parameter1.constructor.name == 'QueryParameter') {
    parameterValue1 = util.inspect(this.parameter1);
  }
  if (typeof this.parameter2 === 'object' && this.parameter1.constructor.name == 'QueryParameter') {
    parameterValue1 = util.inspect(this.parameter1);
  }

  return util.inspect(this.queryField) + ' BETWEEN ' + parameterValue1 + ' AND ' + parameterValue2;
};

QueryBetween.prototype.visit = function(visitor) {
  if (typeof(visitor.visitQueryBetweenOperator) === 'function') {
    visitor.visitQueryBetweenOperator(this);
  }
};

/******************************************************************************
 *                 QUERY NOT EQUAL
 *****************************************************************************/
QueryNe = function(queryField, parameter) {
  this.comparator = ' != ';
  this.operationCode = 5;
  this.queryField = queryField;
  this.parameter = parameter;
};

QueryNe.prototype = new AbstractQueryComparator();

/******************************************************************************
 *                 QUERY IN
 *****************************************************************************/
QueryIn = function(queryField, parameter) {
  this.comparator = ' IN ';
  this.queryField = queryField;
  this.parameter = parameter;
};

QueryIn.prototype = new AbstractQueryComparator();

/******************************************************************************
 *                 ABSTRACT QUERY UNARY OPERATOR
 *****************************************************************************/
var AbstractQueryUnaryOperator = function() {
  this.constants = 1;  // treat NULL and NOT NULL as constants
};

AbstractQueryUnaryOperator.prototype = new AbstractQueryPredicate();

AbstractQueryUnaryOperator.prototype[util.inspect.custom] = function() {
  return util.inspect(this.queryField) + this.operator;
};

AbstractQueryUnaryOperator.prototype.visit = function(visitor) {
  if (typeof(visitor.visitQueryUnaryOperator) === 'function') {
    visitor.visitQueryUnaryOperator(this);
  }
};

/******************************************************************************
 *                 QUERY IS NULL
 *****************************************************************************/
QueryIsNull = function(queryField) {
  this.operator = ' IS NULL';
  this.operationCode = 7;
  this.queryField = queryField;
};

QueryIsNull.prototype = new AbstractQueryUnaryOperator();

/******************************************************************************
 *                 QUERY IS NOT NULL
 *****************************************************************************/
QueryIsNotNull = function(queryField) {
  this.operator = ' IS NOT NULL';
  this.operationCode = 8;
  this.queryField = queryField;
};

QueryIsNotNull.prototype = new AbstractQueryUnaryOperator();

/******************************************************************************
 *                 QUERY AND
 *****************************************************************************/
QueryAnd = function(left, right) {
  this.operator = ' AND ';
  this.operationCode = 1;
  this.predicates = [left, right];
  if(udebug.is_detail()) {udebug.log_detail('QueryAnd<ctor>', this);}
};

QueryAnd.prototype = new AbstractQueryNaryPredicate();

QueryAnd.prototype.getTopLevelPredicates = function() {
  return this.predicates;
};

/** Override the "and" function to collect all predicates in one variable. */
QueryAnd.prototype.and = function(predicate) {
  this.predicates.push(predicate);
  return this;
};

/******************************************************************************
 *                 QUERY OR
 *****************************************************************************/
QueryOr = function(left, right) {
  this.operator = ' OR ';
  this.operationCode = 2;
  this.predicates = [left, right];
  if(udebug.is_detail()) {udebug.log_detail('QueryOr<ctor>', this);}
};

QueryOr.prototype = new AbstractQueryNaryPredicate();

QueryOr.prototype.getTopLevelPredicates = function() {
  return [];
};

/** Override the "or" function to collect all predicates in one variable. */
QueryOr.prototype.or = function(predicate) {
  this.predicates.push(predicate);
  return this;
};

/******************************************************************************
 *                 QUERY NOT
 *****************************************************************************/
QueryNot = function(left) {
  this.operator = ' NOT ';
  this.operationCode = 3;
  this.predicates = [left];
  if(udebug.is_detail()) {udebug.log_detail('QueryNot<ctor>', this, 'parameter', left);}
};

QueryNot.prototype = new AbstractQueryUnaryPredicate();


/******************************************************************************
 *                 QUERY HANDLER
 *****************************************************************************/
/* QueryHandler constructor
 * IMMEDIATE
 * 
 * statically analyze the predicate to decide whether:
 * all primary key fields are specified ==> use primary key lookup;
 * all unique key fields are specified ==> use unique key lookup;
 * some (leading) index fields are specified ==> use index scan;
 * none of the above ==> use table scan
 * Get the query handler for a given query predicate.
 * 
 */
var QueryHandler = function(dbTableHandler, predicate) {
  var candidateIndex;

  udebug.log_detail('QueryHandler<ctor>', predicate);
  this.dbTableHandler = dbTableHandler;
  this.predicate = predicate;

  if (predicate) {
    // Mark constant expressions in each query node
    predicate.visit(theConstMarkerVisitor);

    // Mark the usedColumnMask and equalColumnMask in each query node
    predicate.visit(theMaskMarkerVisitor);

    candidateIndex = dbTableHandler.chooseUniqueIndexForPredicate(predicate);
    if(candidateIndex) {
      this.dbIndexHandler = candidateIndex;
      this.queryType = candidateIndex.dbIndex.isPrimaryKey ? 0 : 1;
      return;   // we're done!
    }

    // otherwise, look for the best ordered index
    candidateIndex = dbTableHandler.chooseOrderedIndexForPredicate(predicate);
  }

  if(candidateIndex) {
    this.dbIndexHandler = candidateIndex;
    this.queryType = 2; // index scan
  } else {
    this.queryType = 3; // table scan
  }
};

/** Get key values from candidate indexes and parameters.
    The value is taken from either the query parameters by name
    or the literal value in the QueryField.
    This is used in Primary Key & Unique Key queries.
    param parameterValues: the parameters object passed to query.execute()
    It returns an array, in key-column order, of the key values from the
    parameter object or the QueryField literal.
*/
QueryHandler.prototype.getKeys = function(parameterValues) {
  var indexColumns = this.dbIndexHandler.indexColumnNumbers;
  var predicate = this.predicate;

  function getValueForColumn(node, columnNumber, values) {
    var i, value;
    if(node.equalColumnMask.bitIsSet(columnNumber)) {
      if(node.queryField && node.queryField.field.columnNumber == columnNumber) {
        udebug.log('QueryHandler.getKeys found column', node.queryField, 'parameter', node.parameter);
        if (isQueryParameter(node.parameter)) {
          value = values[node.parameter.name];
        } else {
          value = getEscapedValue(node.parameter);
        }
        return value;
      }
      if(node.predicates) {
        for(i = 0 ; i < node.predicates.length ; i++) {
          value = getValueForColumn(node, columnNumber, values);
          if(value !== null) {return value;}
        }
      }
    }
    return null;
  }

  var result = [];
  indexColumns.forEach(function(columnNumber) {
    result.push(getValueForColumn(predicate, columnNumber, parameterValues));
  });
  udebug.log_detail('getKeys parameters:', parameterValues, 'key:', result);
  return result;
};

exports.QueryDomainType = QueryDomainType;
exports.QueryProjectionDomainType = QueryProjectionDomainType;
exports.QueryHandler = QueryHandler;
