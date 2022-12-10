/*
 Copyright (c) 2012, 2015 Oracle and/or its affiliates. All rights
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

var jones         = require("database-jones");
var jonesMysql    = require("jones-mysql");
var driver        = require(jones.fs.test_driver);
var storageEngine = null;
var properties;

driver.addCommandLineOption("-e", "--engine", "use named mysql storage engine",
  function(thisArg) {
    storageEngine = thisArg;
    return 1;
  });

driver.processCommandLineOptions();
properties = driver.getConnectionProperties("mysql");

// driver.name is used in summary of results (see jones-test/lib/Result.js)
driver.name = 'mysql';
if(storageEngine) {
   properties.mysql_storage_engine = storageEngine;
   driver.name += '/' + storageEngine;
}

/* Set globals */
global.test_conn_properties = properties;
global.adapter              = "mysql";


/* Find and run all tests */
driver.addSuitesFromDirectory(jones.fs.suites_dir);
driver.addSuitesFromDirectory(jonesMysql.config.suites_dir);
driver.runAllTests();

