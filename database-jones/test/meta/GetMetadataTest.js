/*
 Copyright (c) 2015, Oracle and/or its affiliates. All rights
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

var util        = require("util");
var udebug      = unified_debug.getLogger("GetMetadataTest.js");
var lib         = require("./lib");

var expectedMetadataFor_chartypes = {
  "name" : "chartypes",
  "database" : "test",
  "columnMap" : 
  {
    "id" : {
      "name"            : "id"
  },
    "char30none" : {
      "name"          : "char30none",
      "charsetName"   : 'utf8',
      "length"        : 30
  },
    "char30hash" : {
      "name"          : "char30hash",
      "charsetName"   : 'utf8',
      "length"        : 30
  },
    "char30both" : {
      "name"          : "char30both",
      "charsetName"   : 'utf8',
      "collationName" : 'utf8_swedish_ci',
      "length"        : 30
  },
    "varchar130none" : {
      "name"          : "varchar130none",
      "charsetName"   : 'utf8',
      "length"        : 130
  },
    "varchar130hash" : {
      "name"          : "varchar130hash",
      "charsetName"   : 'utf8',
      "length"        : 130
  },
    "varchar130both" : {
      "name"          : "varchar130both",
      "charsetName"   : 'utf8',
      "collationName" : 'utf8_swedish_ci',
      "length"        : 130
  },
    "text10none" : {
      "name"          : "text10none",
      "charsetName"   : 'utf8'
  },
    "text1000none" : {
      "name"          : "text1000none",
      "charsetName"   : 'utf8'
  },
    "text1000000none" : {
      "name"          : "text1000000none",
      "charsetName"   : 'utf8'
  },
    "text100000000none" : {
      "name"          : "text100000000none",
      "charsetName"   : 'utf8'
  }
  },
  "indexMap": 
    {
      "pk"      : "id",
      "unique"  : { "char30both" : 1, "char30hash" : 1, "id" : 1 },
      "ordered" : { "char30both" : 1, "char30btree": 1, "id" : 1 }
    }
};


var expectedMetadataFor_decimaltypes = {
  "name" : "decimaltypes",
  "database" : "test",
  "columnMap" :
    {
      "id" : {
        "name"          : "id"
    },
      "decimal_1_1" : {
        "name"          : "decimal_1_1",
        "precision"     : 1,
        "scale"         : 1
    },
      "decimal_65_30" : {
        "name"          : "decimal_65_30",
        "precision"     : 65,
        "scale"         : 30
    }
  }
};

var t1 = new harness.SerialTest("getMetadataForCharTypes");
t1.run = function() {
  fail_openSession(t1, t1.testGetMetadata);
};

t1.testGetMetadata = function(session, testCase) {
  session.getTableMetadata( 'test', 'chartypes',function(err, result) {
    if (err) {
      testCase.fail(err);
      return;
    }
    lib.verifyMetadata(testCase, expectedMetadataFor_chartypes, result);
    testCase.failOnError();
  });
};

var t2 = new harness.SerialTest("getMetadataForDecimalTypes");
t2.run = function() {
  fail_openSession(t2, t2.testGetMetadata);
};

t2.testGetMetadata = function(session, testCase) {
  session.getTableMetadata( 'test', 'decimaltypes',function(err, result) {
    if (err) {
      testCase.fail(err);
      return;
    }
    lib.verifyMetadata(testCase, expectedMetadataFor_decimaltypes, result);
    testCase.failOnError();
  });
};

module.exports.tests = [t1, t2];
