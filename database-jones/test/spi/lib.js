/*
 Copyright (c) 2012, Oracle and/or its affiliates. All rights
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
var jones         = require("database-jones"),
    unified_debug = require("unified_debug"),
    service       = jones.getDBServiceProvider(global.adapter),
    properties    = global.test_conn_properties;

var spi_test_connection = null,
    sessionSlot = 0;

function getConnectionPool(userCallback) {
  function onConnect(err, conn) {
    spi_test_connection = conn;
    userCallback(err, conn);
  }

  if(spi_test_connection) {
    userCallback(null, spi_test_connection);
  }
  else {
    service.connect(properties, onConnect);
  }
}


function closeConnectionPool(callback) {
  if(spi_test_connection) {
    spi_test_connection.close(function(err) {
      spi_test_connection = null;
      sessionSlot = 0;
      callback(err);
    });
  } else {
    callback("Not connected");
  }
}


function allocateSessionSlot() {
  return sessionSlot++;
}


/** Open a DBSession or fail the test case */
function fail_openDBSession(testCase, callback) {
  getConnectionPool(function(error, dbConnectionPool) {
    if(dbConnectionPool && ! error) {
      dbConnectionPool.getDBSession(allocateSessionSlot(), function(err, dbSession) {
        if (err) {
          testCase.fail(err);
        } else {
          callback(err, dbSession);
        }
      });
    } else {
      testCase.fail(error);
    }
  });
}


module.exports = {
  "allocateSessionSlot" : allocateSessionSlot,
  "fail_openDBSession"  : fail_openDBSession,
  "closeConnectionPool" : closeConnectionPool,
  "getConnectionPool"   : getConnectionPool
};
