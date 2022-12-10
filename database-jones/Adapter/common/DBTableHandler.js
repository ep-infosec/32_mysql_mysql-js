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

var stats = {
  "constructor_calls"      : 0,
  "created"                : {},
  "default_mappings"       : 0,
  "explicit_mappings"      : 0,
  "return_null"            : 0,
  "result_objects_created" : 0,
  "DBIndexHandler_created" : 0
};

var assert          = require("assert"),
    util            = require("util"),
    jones           = require("database-jones"),
    unified_debug   = require("unified_debug"),
    TableMapping    = jones.TableMapping,
    FieldMapping    = require(jones.api.TableMapping).FieldMapping,
    stats_module    = require(jones.api.stats),
    BitMask         = require(jones.common.BitMask),
    udebug          = unified_debug.getLogger("DBTableHandler.js");

var DBIndexHandler;

stats_module.register(stats,"spi","DBTableHandler");

/* A DBTableHandler (DBT) combines dictionary metadata with user mappings.  
   It manages setting and getting of columns based on the fields of a
   user's domain object.  It can also choose an index access path by 
   comapring user-supplied key fields of a domain object with a table's indexes.

   A DBT encapsulates:
     * A TableMetadata object, obtained from the data dictionary and passed to
       the DBT constructor.  This is immutable.

     * A resolved TableMapping, created from the TableMapping passed in to the
       constrcutor (or created by default).

     * A list of columns, which contains the subset of a table's columns needed
       to fulfill the TableMapping. Columns are accessed by number.  The 
       ordering of columns in a DBT preserves the ordering found in the 
       TableMetadata.

     * A set of mapped fields.  Fields are accessed by name.  The set includes 
       all fields explicitly mapped in the TableMapping, plus fields that are
       implicitly mapped due to the TableMapping.mapAllColumns() flag.

    The mapping from fields to columns can be 1-to-1, 1-to-many, or many-to-1.

    Within a DBT, a DBTableHandlerPrivate manages the mapping of fields to 
    columns.
*/


/* getColumnByName() is a utility function used in the building of maps.
*/
function getColumnByName(dbTable, colName) {
  var i, col;
  
  for(i = 0 ; i < dbTable.columns.length ; i++) {
    col = dbTable.columns[i];
    if(col.name === colName) {
      return col;
    }
  }
  udebug.log("getColumnByName", colName, "NOT FOUND.");
  return null;
}

//////////////////
/// DBT_Column represents a mapped column
//////////////////

function DBT_Column(columnMetadata, converter) {
  this.columnName         = columnMetadata.name;
  this.fieldNames         = [];
  this.fieldConverters    = [];
  this.isMapped           = false; // Has any field mapping
  this.isShared           = false; // Many fields to 1 column
  this.isPartial          = false; // 1 field to many columns
  this.excludedFieldNames = [];    // If column is a container for sparse fields
  this.typeConverter      = converter || columnMetadata.typeConverter;
  this.getColumnValue     = this.getColumnValue_1to1;
  this.setFieldValues     = this.setFieldValues_1to1;
}

DBT_Column.prototype.addFieldMapping = function(mapping, reportError) {
  if(mapping.meta && mapping.meta.isShared) {
    this.isShared = true;
    this.getColumnValue = this.getColumnValue_Shared;
    this.setFieldValues = this.setFieldValues_Shared;
  }
  this.fieldNames.push(mapping.fieldName);
  this.fieldConverters.push(mapping.converter);
  if(this.fieldNames.length > 1 && ! this.isShared) {
    reportError(
      "Column " + this.columnName + " is used by multiple fields but field "
      + mapping.fieldName + " does not mark it as shared."
    );
  } else {
    this.isMapped = true;
  }
};

DBT_Column.prototype.mapPartial = function(mapping, n) {
  this.isMapped = true;
  this.isPartial = true;
  this.isFirst = (n === 0);
  this.isLast  = (n === mapping.toManyColumns.length - 1);
  this.fieldNames.push(mapping.fieldName);
  this.fieldConverters.push(mapping.converter);
  this.getColumnValue = this.getColumnValue_Partial;
  this.setFieldValues = this.setFieldValues_Partial;
};

DBT_Column.prototype.setSparse = function(tableMapping) {
  this.isMapped = true;
  this.isShared = true;
  this.excludedFieldNames = tableMapping.excludedFieldNames;
  this.typeConverter = tableMapping.sparseContainer.converter ||
                                           this.typeConverter ||
                               jones.converters.JSONConverter;
  this.getColumnValue = this.getColumnValue_Sparse;
  this.setFieldValues = this.setFieldValues_Sparse;
};

DBT_Column.prototype.setUnmappable = function() {
  /* Column has no mapping, but cannot be implicitly mapped because a
     Field mapping exists using the column name. */
  this.getColumnValue = this.getColumnValue_Unmapped;
  this.setFieldValues = this.setFieldValues_Unmapped;
};

DBT_Column.prototype.toDB = function(value) {
  return this.typeConverter ? this.typeConverter.toDB(value) : value;
};

DBT_Column.prototype.fromDB = function(value) {
  return this.typeConverter ? this.typeConverter.fromDB(value) : value;
};

DBT_Column.prototype.getColumnValue_1to1 = function(domainObject) {
  var value = domainObject[this.fieldNames[0]];
  if(this.fieldConverters[0]) {
    value = this.fieldConverters[0].toDB(value);
  }
  return this.toDB(value);
};

DBT_Column.prototype.setFieldValues_1to1 = function(domainObject, columnValue) {
  columnValue = this.fromDB(columnValue);
  if(this.fieldConverters[0]) {
    columnValue = this.fieldConverters[0].fromDB(columnValue);
  }
  domainObject[this.fieldNames[0]] = columnValue;
};

DBT_Column.prototype.getColumnValue_Partial = function(domainObject) {
  var fieldName, intermediateValue; // writing to db - one field to many columns
  fieldName = this.fieldNames[0];                     // intermediate type is {}
  if(this.isFirst && this.fieldConverters[0]) {
    domainObject[fieldName] = this.fieldConverters[0].toDB(domainObject[fieldName]);
  }
  intermediateValue = domainObject[fieldName];
  if(this.isLast && this.fieldConverters[0]) {
    domainObject[fieldName] = this.fieldConverters[0].fromDB(intermediateValue);
  }
  if(typeof intermediateValue === 'object') {
    return this.toDB(intermediateValue[this.columnName]);
  }
  // fallthrough; value not of proper intermediate type; return undefined.
};

DBT_Column.prototype.setFieldValues_Partial = function(domainObject, columnValue) {
  var fieldName = this.fieldNames[0];                       // reading from db
  if(this.isFirst) {
    domainObject[fieldName] = {};  // intermediate type; column names are keys
  }
  domainObject[fieldName][this.columnName] = this.fromDB(columnValue);
  if(this.isLast && this.fieldConverters[0]) {
    domainObject[fieldName] = this.fieldConverters[0].fromDB(domainObject[fieldName]);
  }
};

DBT_Column.prototype.getColumnValue_Shared = function(domainObject) {
  var i, value, name;            // writing to db -- many fields to one column
  value = {};                       // intermediate type; field names are keys

  for(i = 0 ; i < this.fieldNames.length ; i++) {
    name = this.fieldNames[i];
    value[name] = domainObject[name];
    if(this.fieldConverters[i]) {
      value[name] = this.fieldConverters[i].toDB(value[name]);
    }
  }
  return this.toDB(value);
};

DBT_Column.prototype.setFieldValues_Shared = function(domainObject, columnValue) {
  var i, name, value;          // reading from db -- many fields to one column
  columnValue = this.fromDB(columnValue);

  for(i = 0 ; i < this.fieldNames.length ; i++) {
    name = this.fieldNames[i];
    value = columnValue[name];
    if(this.fieldConverters[i]) {
      value = this.fieldConverters[i].fromDB(value);
    }
    domainObject[name] = value;
  }
};

DBT_Column.prototype.getColumnValue_Sparse = function(domainObject) {
  var value, candidateField;       // writing to db -- all non-excluded fields
  value = {};                       // intermediate type; field names are keys

  for(candidateField in domainObject) {
    if(domainObject.hasOwnProperty(candidateField)) {
      if(this.excludedFieldNames.indexOf(candidateField) === -1) {
        value[candidateField] = domainObject[candidateField];
      }
    }
  }
  return this.toDB(value);
};

DBT_Column.prototype.setFieldValues_Sparse = function(domainObject, columnValue) {
  var candidateField;                      // reading serialized from database
  columnValue = this.fromDB(columnValue);

  if(typeof columnValue === 'object') {
    for(candidateField in columnValue) {
      if(columnValue.hasOwnProperty(candidateField)) {
        domainObject[candidateField] = columnValue[candidateField];
      }
    }
  }
};

DBT_Column.prototype.getColumnValue_Unmapped = function() {};

DBT_Column.prototype.setFieldValues_Unmapped = function() {};

DBT_Column.prototype.hasConverter = function() {
  return (this.typeConverter || this.fieldConverters[0]);
};

//////////////////
/// DBT_Field represents a mapped field
/// It stores a BitMask of column numbers in the resolved mapping
//////////////////

function DBT_Field(mapping, maskSize) {
  this.mapping = mapping;
  if(maskSize > 0) {
    this.mapping.columnMask = new BitMask(maskSize);
    this.ncol = 0;
  } // otherwise, field is a relationship field
}

DBT_Field.prototype.mapToColumn = function(colNumber) {
  this.mapping.columnMask.set(colNumber);
  this.mapping.columnNumber = (++this.ncol === 1 ? colNumber : undefined);
};


//////////////////
/// DBTableHandlerPrivate: column-to-field mappings
//////////////////

function DBTableHandlerPrivate(dbTableHandler, maxColumns) {
  this.columnNameToIdMap = {};
  this.columns           = [];    // Array of DBT_Column
  this.columnMetadata    = [];    // Array of ColumnMetadata
  this.fields            = {};    // FieldName => DBT_Field
  this.maxColumns        = maxColumns;
  this.reportError       = function(message)  {
    dbTableHandler.appendErrorMessage(message);
  };
}

DBTableHandlerPrivate.prototype[util.inspect.custom] = function() {
  return "";
};

DBTableHandlerPrivate.prototype.addColumn = function(columnMetadata, converterMap) {
  var n, col;
  n = this.columns.length;
  col = new DBT_Column(columnMetadata, converterMap[columnMetadata.name]);
  this.columnNameToIdMap[columnMetadata.name] = n;
  this.columns[n] = col;
  this.columnMetadata[n] = columnMetadata;
};

DBTableHandlerPrivate.prototype.addColumnFromParent = function(parent, colName) {
  var n, parentColumnId, col, i, fieldName;
  n = this.columns.length;
  parentColumnId = parent.columnNameToIdMap[colName];
  this.columnNameToIdMap[colName] = n;
  col = parent.columns[parentColumnId];
  this.columns[n] = col;
  this.columnMetadata[n] = parent.columnMetadata[parentColumnId];
  for(i = 0 ; i < col.fieldNames.length ; i++) {
    fieldName = col.fieldNames[i];
    this.fields[fieldName] = parent.fields[fieldName];
  }
};

DBTableHandlerPrivate.prototype.mapFieldToColumns = function(mapping) {
  var n, id;
  if(mapping.toManyColumns) {
    n = 0;
    for(id = 0 ; id < this.columns.length ; id++) {  // work in column order
      if(mapping.toManyColumns.indexOf(this.columns[id].columnName) !== -1) {
        this.fields[mapping.fieldName].mapToColumn(id);
        this.columns[id].mapPartial(mapping, n++);
      }
    }
    if(mapping.toManyColumns.length !== n) {
      this.reportError("Bad column list in field " + mapping.fieldName +
                       ": " + mapping.toManyColumns + "(used " + n + ")");
    }
  } else {                                           // map to just one column
    id = this.columnNameToIdMap[mapping.columnName || mapping.fieldName];
    if(id >= 0) {
      this.columns[id].addFieldMapping(mapping, this.reportError);
      this.fields[mapping.fieldName].mapToColumn(id);
    } else if(this.sparseColumnId >= 0) {
      this.columns[this.sparseColumnId].addFieldMapping(mapping);
      this.fields[mapping.fieldName].mapToColumn(this.sparseColumnId);
    } else {
      this.reportError("No column for field " + mapping.fieldName);
    }
  }
};

DBTableHandlerPrivate.prototype.addField = function(mapping) {
  if(this.fields[mapping.fieldName]) {
    this.reportError("Attempt to map field " + mapping.fieldName + " more than once");
  } else {
    if(mapping.relationship) {
      this.fields[mapping.fieldName] = new DBT_Field(mapping, 0);
    } else {
      this.fields[mapping.fieldName] = new DBT_Field(mapping, this.maxColumns);
      this.mapFieldToColumns(mapping);
    }
  }
};

DBTableHandlerPrivate.prototype.setSparseColumn = function(id, tableMapping) {
  this.sparseColumnId = id;
  this.columns[id].setSparse(tableMapping);
};

DBTableHandlerPrivate.prototype.getColumnMetadata = function(idOrName) {
  var id = idOrName;
  if(typeof idOrName === 'string') {
    id = this.columnNameToIdMap[idOrName];
  }
  if(id !== undefined) {
    return this.columnMetadata[id];
  }
};

DBTableHandlerPrivate.prototype.getColumnMapping = function(id) {
  if(id !== undefined) {
    return this.columns[id];
  }
};

DBTableHandlerPrivate.prototype.getColumnMappingByName = function(name) {
  var id = this.columnNameToIdMap[name];
  if(id !== undefined) {
    return this.columns[id];
  }
};

DBTableHandlerPrivate.prototype.getNumberOfMappedColumns = function() {
  var total=0;
  this.columns.forEach(function(col) {
    if(col.isMapped && ! col.excludedFieldNames.length) {
      total++;
    }
  });
  return total;
};

/* DBTableHandler() constructor
   IMMEDIATE

   Create a DBTableHandler for a table and a mapping.

   If dbtable is null or has no columns, this function returns null.

   If the tablemapping is null, a default TableMapping will be created 
   and used. 
*/
function DBTableHandler(dbtable, tablemapping, ctor) {
  var i,               // an iterator
      field,           // a field
      col,             // a column
      id,              // a column id number
      index,           // a DBIndex
      columnNames,     // array of the mapped column names
      foreignKey,      // foreign key object from dbTable
      priv;            // our DBTableHandlerPrivate

  var dbTableHandler = this;
  var invalidateCallback;

  stats.constructor_calls++;

  if(! ( dbtable && dbtable.columns)) {
    stats.return_null++;
    return null;
  }

 if(stats.created[dbtable.name] === undefined) {
    stats.created[dbtable.name] = 1;
  } else {
    stats.created[dbtable.name]++;
  }
  
  /* Default properties */
  priv                        = new DBTableHandlerPrivate(this, dbtable.columns.length);
  this._private               = priv;
  this.dbTable                = dbtable;
  this.ValueObject            = null;
  this.errorMessages          = "";
  this.isValid                = true;
  this.autoIncFieldName       = null;
  this.autoIncColumnNumber    = null;
  this.numberOfLobColumns     = 0;
  this.newObjectConstructor   = ctor;
  this.dbIndexHandlers        = [];
  this.foreignKeyMap          = {};
  this.sparseContainer        = null;
  this.is1to1                 = true;
  this.relationshipFields     = [];
  if(tablemapping) {
    if(tablemapping.isValid()) {
      stats.explicit_mappings++;
    } else {
      this.errorMessages = tablemapping.error;
      this.isValid = false;
      return;
    }
  }
  else {                                          // Create a default mapping
    stats.default_mappings++;
    tablemapping          = new TableMapping(this.dbTable.name);
    tablemapping.database = this.dbTable.database;
  }

  /* Make a copy of the mapping and store it as the "resolved" mapping */
  this.resolvedMapping = new TableMapping(tablemapping);
  this.resolvedMapping.mapAllColumns = false;  // all fields will be present

  /* Build an array of column names.  This will establish column order. */
  columnNames = [];
  function addColumnName(name) {
    if(name && getColumnByName(dbtable, name) && columnNames.indexOf(name) === -1) {
      columnNames.push(name);
    }
  }

  if(tablemapping.mapAllColumns) {        // Use all columns from dictionary
    for(i = 0 ; i < dbtable.columns.length ; i++) {
      columnNames.push(dbtable.columns[i].name);
    }
  } else {        // Use all mapped columns plus any sparse container column
    for(i = 0 ; i < tablemapping.fields.length ; i++) {
      field = tablemapping.fields[i];
      if(field.persistent) {
        if(field.toManyColumns) {
          field.toManyColumns.forEach(addColumnName);
        } else {
          addColumnName(field.columnName || field.fieldName);
        }
      }
    }
    addColumnName(dbtable.sparseContainer);
  }
  udebug.log("DBTableHandler columns", columnNames);


  /* Build the array of columns.
  */
  for(id = 0 ; id < columnNames.length ; id++) {
    priv.addColumn(getColumnByName(dbtable, columnNames[id]),
                   tablemapping.columnConverterMap);
  }

  /* Build the array of mapped fields. */
  /* Start with persistent fields from the TableMapping */
  for(i = 0; i < this.resolvedMapping.fields.length ; i++) {
    field = this.resolvedMapping.fields[i];
    if(field.persistent) {
      priv.addField(field);
    }
  }
  /* Add a default field mapping for any yet-unmapped columns */
  if(tablemapping.mapAllColumns) {
    for(i = 0 ; i < priv.columns.length ; i++) {
      if(! priv.columns[i].isMapped) {
        field = priv.columnMetadata[i].name;
        if(priv.fields[field]) {
          priv.columns[i].setUnmappable();
        } else {
          this.resolvedMapping.mapField({"fieldName":field,"columnName":field});
          priv.addField(this.resolvedMapping.getFieldMapping(field));
        }
      }
    }
  }

  /* Iterate over all columns.
   * Set internal pointers for notable columns.
  */
  for(id = 0 ; id < columnNames.length ; id++) {
    col = columnNames[id];
    if(this.resolvedMapping.sparseContainer &&
       this.resolvedMapping.sparseContainer.columnName === col) {
      this.sparseContainer = col;
      priv.setSparseColumn(id, this.resolvedMapping);
    } else if(dbtable.sparseContainer === col && ! priv.columns[id].isMapped) {
      this.resolvedMapping.mapSparseFields(col);
      this.sparseContainer = col;
      priv.setSparseColumn(id, this.resolvedMapping);
    }
    if(priv.columnMetadata[id].isAutoincrement) {
      this.autoIncColumnNumber = i;
      this.autoIncFieldName = priv.columns[id].fieldNames[0];
    }
    if(priv.columnMetadata[id].isLob) {
      this.numberOfLobColumns++;
    }
    if(priv.columns[id].isShared || priv.columns[id].isPartial) {
      this.is1to1 = false;
    }
  }

  /* Iterate over all field mappings.
   * Build the array of relationshipFields.
   * For all persistent fields, resolve field.columnName.
   */
  for(i = 0 ; i < this.resolvedMapping.fields.length ; i++) {
    field = this.resolvedMapping.fields[i];
    if(field.relationship) {
      this.relationshipFields.push(field);
    } else if(field.persistent) {
      if(field.columnName) {
        if(! this._private.getColumnMappingByName(field.columnName)) {
          this.resolvedMapping.error += "Column " + field.columnName + " does not exist\n";
        }
      } else if(! field.toManyColumns) {
        if(this._private.getColumnMappingByName(field.fieldName)) {
          field.columnName = field.fieldName;
        } else if(this.sparseContainer) {
          field.columnName = this.sparseContainer;
        } else {
          this.resolvedMapping.error += "No column mapped for field " + field.fieldName + "\n";
        }
      }
    }
    if(field.columnName !== this.sparseContainer) {
      this.resolvedMapping.fieldIsNotSparse(field.fieldName);
    }
  }

  // build a dbIndexHandler for each usable dbIndex
  for (i = 0; i < this.dbTable.indexes.length; ++i) {
    index = this.dbTable.indexes[i];
    if(this.hasColumnsFromTable(index.columnNumbers)) {
      this.dbIndexHandlers.push(new DBIndexHandler(this, index));
    }
  }
  // build foreign key map
  for (i = 0; i < this.dbTable.foreignKeys.length; ++i) {
    foreignKey = this.dbTable.foreignKeys[i];
    this.foreignKeyMap[foreignKey.name] = foreignKey;
  }

  // set the invalidate callback if this db table handler is valid
  if (dbTableHandler.isValid) {
    invalidateCallback = function() {
      udebug.log('invalidateCallback called for dbTableHandler',
          ctor?'for constructor '+ctor.name:'default', 'for table', dbtable.database+'.'+dbtable.name);
      dbTableHandler.isValid = false;
    };
    dbtable.registerInvalidateCallback(invalidateCallback);
  }
  udebug.log("Constructor completed -- ", this);
}

DBTableHandler.prototype.getResolvedMapping = function() {
  return this.resolvedMapping;
};

DBTableHandler.prototype.getColumnMapping = function(id) {
  return this._private.getColumnMapping(id);
};

DBTableHandler.prototype.getColumnMetadata = function(idOrName) {
  return this._private.getColumnMetadata(idOrName);
};

DBTableHandler.prototype.getAllColumnMetadata = function() {
  return this._private.columnMetadata;
};

DBTableHandler.prototype.getNumberOfColumns = function() {
  return this._private.columns.length;
};

DBTableHandler.prototype.getFieldMapping = function(fieldName) {
  if(this._private.fields[fieldName]) {
    return this._private.fields[fieldName].mapping;
  }
};

DBTableHandler.prototype.getAllQueryFields = function() {
  return this.resolvedMapping.fields;
};

DBTableHandler.prototype.getNumberOfFields = function() {
  return this.resolvedMapping.fields.length;
};

DBTableHandler.prototype.getColumnMaskForField = function(name) {
  if(this._private.fields[name]) {
    return this._private.fields[name].mapping.columnMask;
  }
};


DBTableHandler.prototype[util.inspect.custom] = function() {
  var s, fields, ncol, columns, nrelationships, ctorName;
  if(this.isValid) {
    fields = this.getNumberOfFields() == 1 ? " field" : " fields";
    ncol = this._private.getNumberOfMappedColumns();
    nrelationships = this.relationshipFields.length;
    columns =  (ncol == 1 ? " column" : " columns");
    ctorName = this.newObjectConstructor? ' constructor: ' + this.newObjectConstructor.name: ' no constructor';
    s = "DBTableHandler for table " + this.dbTable.name +
        " with " + this.getNumberOfFields() + fields +
        " mapped to " + ncol + columns +
        " and " + nrelationships + " relationships" +
        ctorName;
    if(this.sparseContainer) {
      s += " and sparse column " + this.sparseContainer;
    }
  } else {
    s = "Invalid DBTableHandler with error: " + this.errorMessages;
  }
  return s;
};

/** Append an error message and mark this DBTableHandler as invalid.
 */
DBTableHandler.prototype.appendErrorMessage = function(msg) {
  this.errorMessages += '\n' + msg;
  this.isValid = false;
};


DBTableHandler.prototype.createResultObject = function() {
  var ctor, newDomainObj;
  ctor = this.newObjectConstructor;

  if(ctor && ctor.prototype) {
    udebug.log("createResultObject() with user constructor", ctor.name, "and prototype");
    newDomainObj = Object.create(ctor.prototype);
    ctor.call(newDomainObj);
  } else if(ctor) {
    udebug.log("createResultObject() with user constructor", ctor.name);
    newDomainObj = {};
    ctor.call(newDomainObj);
  } else {
    udebug.log("createResultObject() [no user constructor]");
    newDomainObj = {};
  }

  stats.result_objects_created++;
  return newDomainObj;
};

/* DBTableHandler.newResultObject
   IMMEDIATE
   
   Create a new object using the constructor function (if set).
*/
DBTableHandler.prototype.newResultObject = function(values) {
  var newDomainObj = this.createResultObject();
  if (typeof values === 'object') {
    this.setFields(newDomainObj, values);
  }
  udebug.log("newResultObject", newDomainObj);
  return newDomainObj;
};

/* DBTableHandler.newResultObjectFromRow
 * IMMEDIATE

 * Create a new object using the constructor function (if set).
 * Values for the object's fields come from the row; first the key fields
 * and then the non-key fields. The row contains items named '0', '1', etc.
 * The value for the first key field is in row[offset]. Values obtained
 * from the row are first processed by the db converter and type converter
 * if present.
 */
DBTableHandler.prototype.newResultObjectFromRow = function(row, offset,
                                                           keyFields,
                                                           nonKeyFields) {
  var fieldIndex, rowValue, field, newDomainObj;

  udebug.log("newResultObjectFromRow");
  newDomainObj = this.createResultObject();

  // set key field values from row using type converters
  for (fieldIndex = 0; fieldIndex < keyFields.length; ++fieldIndex) {
    rowValue = row[offset + fieldIndex];
    field = keyFields[fieldIndex];
    this.set(newDomainObj, field.columnNumber, rowValue);
  }
  
  // set non-key field values from row using type converters
  offset += keyFields.length;
  for (fieldIndex = 0; fieldIndex < nonKeyFields.length; ++fieldIndex) {
    rowValue = row[offset + fieldIndex];
    field = nonKeyFields[fieldIndex];
    this.set(newDomainObj, field.columnNumber, rowValue);
  }
  
  udebug.log("newResultObjectFromRow done", newDomainObj);
  return newDomainObj;
};

/* setAutoincrement(object, autoincrementValue)
 * IMMEDIATE
 * Store autoincrement value into object
 */
DBTableHandler.prototype.setAutoincrement = function(object, autoincrementValue) {
  if(typeof this.autoIncColumnNumber === 'number') {
    object[this.autoIncFieldName] = autoincrementValue;
    udebug.log("setAutoincrement", this.autoIncFieldName, ":=", autoincrementValue);
  }
};


/* chooseIndex(keys, allowUnique, allowScan)
 Returns a preferred DBIndexHandler, or null if none available.
 From API find():
   * The parameter "keys" may be of any type. Keys must uniquely identify
   * a single row in the database. If keys is a simple type
   * (number or string), then the parameter type must be the 
   * same type as or compatible with the primary key type of the mapped object.
   * Otherwise, properties are taken
   * from the parameter and matched against property names in the
   * mapping.
*/
DBTableHandler.prototype.chooseIndex = function(keys, allowUnique, allowScan) {
  var indexHandler, fieldName, mask, predicate, ncol, pkcol0;

  udebug.log("chooseIndex for:", keys);
  indexHandler = null;
  ncol = this.getNumberOfColumns();

  /* Create bitmasks over the key columns */
  predicate = {
    "usedColumnMask"  : new BitMask(ncol),   // all keys
    "equalColumnMask" : new BitMask(ncol)    // only non-null keys
  };

  if((typeof keys === 'number' || typeof keys === 'string')) {
    /* A simple key value represents first column of primary key */
    pkcol0 = this.dbIndexHandlers[0].indexColumnNumbers[0];
    predicate.usedColumnMask.set(pkcol0);
    predicate.equalColumnMask.set(pkcol0);
  }
  else {
    for (fieldName in keys) {
      if (keys.hasOwnProperty(fieldName) && keys[fieldName] !== undefined ) {
        mask = this.getColumnMaskForField(fieldName);
        if(mask) {
          predicate.usedColumnMask.orWith(mask);
          if(keys[fieldName] !== null) {
            predicate.equalColumnMask.orWith(mask);
          }
        }
      }
    }
  }
  udebug.log("KeyMasks:", predicate);

  /* Look for a unique index */
  if(allowUnique) {
    indexHandler = this.chooseUniqueIndexForPredicate(predicate);
  }

  /* Look for an ordered index */
  if(allowScan && ! indexHandler) {
    indexHandler = this.chooseOrderedIndexForPredicate(predicate);
  }

  return indexHandler;
};

/* Return the first unique index that matches all predicate columns
*/
DBTableHandler.prototype.chooseUniqueIndexForPredicate = function(predicate) {
  var i, idxs, indexHandler, columnMask;
  columnMask = predicate.equalColumnMask;
  idxs = this.dbIndexHandlers;
  for(i = 0 ; i < idxs.length ; i++) {
    if(idxs[i].dbIndex.isUnique) {
      indexHandler = idxs[i];
      if(columnMask.and(indexHandler.columnMask).isEqualTo(indexHandler.columnMask)) {
        return indexHandler;
      }
    }
  }
  return null;
};

/* Score all ordered indexes and return the one with the best score
*/
DBTableHandler.prototype.chooseOrderedIndexForPredicate = function(predicate) {
  var i, idxs, indexHandler, score, highScore, highScorer;
  udebug.log("ChooseOrderedIndexForPredicate", predicate, predicate.usedColumnMask);
  idxs = this.dbIndexHandlers;
  highScore = 0;
  highScorer = null;
  for(i = 0 ; i < idxs.length ; i++) {
    if(idxs[i].dbIndex.isOrdered) {
      indexHandler = idxs[i];
      score = indexHandler.score(predicate);
      udebug.log("Ordered index", i, "scored", score);
      if(score > highScore) {
        highScore = score;
        highScorer = indexHandler;
      }
    }
  }
  return highScorer;
};

/** 
 * For domain object obj, return the value of column colNumber.
 * If a valueDefinedListener is passed, notify it via setDefined or setUndefined.
 */
DBTableHandler.prototype.get = function(domainObject, colNumber, valueDefinedListener) {
  var result, columnMetadata;

  /* Handle the case where obj is a simple string or number value */
  if (typeof domainObject === 'string' || typeof domainObject === 'number') {
    result = domainObject;
  } else {
    result = this._private.columns[colNumber].getColumnValue(domainObject);
  }

  if(valueDefinedListener) {
    if(result === undefined) {
      valueDefinedListener.setUndefined(colNumber);
    } else {
      valueDefinedListener.setDefined(colNumber);
      columnMetadata = this._private.columnMetadata[colNumber];
      if(columnMetadata.isBinary && result.constructor &&
                  result.constructor.name !== 'Buffer'   ) {
        valueDefinedListener.setError(columnMetadata.name, "22000",
                                      "Value for binary column must be a Buffer");
      }
    }
  }

  return result;
};


/* Return an array of column value 
*/
DBTableHandler.prototype.getColumns = function(obj, valueDefinedListener) {
  var colummnValues, i;
  colummnValues = [];
  for( i = 0 ; i < this.getNumberOfColumns() ; i ++) {
    colummnValues[i] = this.get(obj, i, valueDefinedListener);
  }
  return colummnValues;
};


/* Set field to value */
DBTableHandler.prototype.set = function(obj, columnNumber, value) {
  return this.getColumnMapping(columnNumber).setFieldValues(obj, value);
};


/* Set all fields of domainObject from valueObject.
 *  valueObject has properties corresponding to column names.
*/
DBTableHandler.prototype.setFields = function(obj, values) {
  var i, value, columnName;
  for (i = 0; i < this.getNumberOfColumns(); ++i) {
    columnName = this.getColumnMetadata(i).name;
    value = values[columnName];
    if (value !== undefined) {
      this.set(obj, i, value);
    }
  }
};

/* Returns true if a column or field converter applies to a column value
*/
DBTableHandler.prototype.columnHasConverter = function(columnNumber) {
  return this.getColumnMapping(columnNumber).hasConverter();
};


/* DBTableHandler getIndexHandler(Object keys)
   IMMEDIATE

   Given an object containing keys as defined in API Context.find(),
   choose an index to use as an access path for the operation,
   and return a DBIndexHandler for that index.
*/
DBTableHandler.prototype.getIndexHandler = function(keys) {
  return this.chooseIndex(keys, true, true);
};

DBTableHandler.prototype.getUniqueIndexHandler = function(keys) {
  return this.chooseIndex(keys, true, false);
};

DBTableHandler.prototype.getOrderedIndexHandler = function(keys) {
  return this.chooseIndex(keys, false, true);
};

DBTableHandler.prototype.getForeignKey = function(foreignKeyName) {
  return this.foreignKeyMap[foreignKeyName];
};

DBTableHandler.prototype.getForeignKeyNames = function() {
  return Object.keys(this.foreignKeyMap);
};

DBTableHandler.prototype.hasColumnsFromTable = function(columnNumbers) {
  var usable = true;
  columnNumbers.forEach(function(colNo) {
    var colName = this.dbTable.columns[colNo].name;
    if(this._private.columnNameToIdMap[colName] === undefined) {
      usable = false;
    }
  }, this);
  return usable;
};

//////// DBIndexHandler             /////////////////

DBIndexHandler = function(parent, dbIndex) {
  var maxCols, i, tableColNo, handlerColNo, colName, allDbtFields, fieldMappings;
  maxCols = parent._private.columns.length;
  stats.DBIndexHandler_created++;

  this.tableHandler = parent;
  this.dbIndex = dbIndex;
  this.indexColumnNumbers = [];
  this.singleColumn = null;
  this._private = new DBTableHandlerPrivate(this, maxCols);
  this.columnMask = new BitMask(maxCols);

  for(i = 0 ; i < dbIndex.columnNumbers.length ; i++) {
    tableColNo = dbIndex.columnNumbers[i];
    colName = parent.dbTable.columns[tableColNo].name;
    handlerColNo = parent._private.columnNameToIdMap[colName];
    this.indexColumnNumbers.push(handlerColNo);
    this.columnMask.set(handlerColNo);
    this._private.addColumnFromParent(parent._private, colName);
  }

  fieldMappings = [];
  allDbtFields = this._private.fields;
  this._private.columns.forEach(function(dbtColumn) {
    dbtColumn.fieldNames.forEach(function(fieldName) {
      fieldMappings.push(allDbtFields[fieldName].mapping);
    });
  });
  this.fieldMappings = fieldMappings;

  if(i === 1) {                                      // One-column index
    this.singleColumn = this.getColumnMetadata(0);
  }
  udebug.log("Constructor completed:", this);
};

/* DBIndexHandler inherits some methods from DBTableHandler 
*/
DBIndexHandler.prototype = {
  getColumnMapping       : DBTableHandler.prototype.getColumnMapping,
  getColumnMetadata      : DBTableHandler.prototype.getColumnMetadata,
  getAllColumnMetadata   : DBTableHandler.prototype.getAllColumnMetadata,
  getNumberOfColumns     : DBTableHandler.prototype.getNumberOfColumns,
  get                    : DBTableHandler.prototype.get,
  getColumns             : DBTableHandler.prototype.getColumns,
  appendErrorMessage     : DBTableHandler.prototype.appendErrorMessage
};

DBIndexHandler.prototype[util.inspect.custom] = function() {
  return "DBIndexHandler for" +
         (this.dbIndex.isUnique ? " unique" : "") +
         (this.dbIndex.isOrdered ? " ordered" : "") +
         " index " + this.dbIndex.name + " with " + this.fieldMappings.length +
         " field(s) over column(s) " + this.indexColumnNumbers;
};

DBIndexHandler.prototype.getNumberOfFields = function() {
  return this.fieldMappings.length;
};

DBIndexHandler.prototype.getField = function(n) {
  return this.fieldMappings[n];
};

/* Determine whether index is usable for a particular Query predicate
*/
DBIndexHandler.prototype.isUsable = function(predicate) {
  var usable = false;
  if(this.dbIndex.isUnique) {
    usable = predicate.equalColumnMask.and(this.columnMask).isEqualTo(this.columnMask);
  } else if(this.dbIndex.isOrdered) {
    usable = predicate.usedColumnMask.bitIsSet(this.indexColumnNumbers[0]);
  }
  return usable;
};

/* Score an index for a Query predicate.
   Score 1 point for each consecutive key part used plus 1 more point
   if the column is in QueryEq. 
*/
DBIndexHandler.prototype.score = function(predicate) {
  var score, point, i, colNo;
  score = 0;
  i = 0;
  do {
    colNo = this.indexColumnNumbers[i];
    point = predicate.usedColumnMask.bitIsSet(colNo);
    if(point) { 
      score += 1;
      if(predicate.equalColumnMask.bitIsSet(colNo)) {
        score += 1;
      }
    }
    i++;
  } while(point && i < this.indexColumnNumbers.length);

  udebug.log_detail('score', this.dbIndex.name, 'is', score);
  return score;
};


exports.DBTableHandler = DBTableHandler;
