/*
 Copyright (c) 2015 Oracle and/or its affiliates. All rights
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

global.harness   = require("jones-test");
var driver       = new harness.Driver();
var utilities    = require("./utilities");
var jones        = require("database-jones");
var stats_module = require(jones.api.stats);
var cmdLineProperties;
var deployment   = "test";

/* Hack the prototypes for SerialTest and ConcurrentTest 
   to ensure that a test case always closes its session
*/
harness.SerialTest.prototype.onComplete = function() {
  if(this.session && ! this.session.isClosed()) {
    this.session.close();
  }
};

harness.ConcurrentTest.prototype.onComplete = function() {
  if(this.session && ! this.session.isClosed()) {
    this.session.close();
  }
};

driver.statsDomain = null;

driver.addCommandLineOption("", "--set <var>=<value>", "set a connection property",
  function(nextArg) {
    var val;
    if(! cmdLineProperties) {
      cmdLineProperties = {};
    }
    var pair = nextArg.split('=');
    if(pair.length === 2) {
      val = pair[1];
      if(val === 'true')       { val = true;  }
      else if(val === 'false') { val = false; }
      cmdLineProperties[pair[0]] = val;
      return 1;
    }
    console.log("Invalid --set option " + nextArg);
    return -1;
  });

driver.addCommandLineOption("", "--stats=<query>",
  "show server statistics after test run",
  function(thisArg) {
    driver.doStats = true;
    if(typeof thisArg === "string") {
      driver.statsDomain = thisArg;
      return 1;
    }
    driver.statsDomain = "/";
    return 0;
  });

driver.addCommandLineOption("-E", "--deployment=<name>",
  "use deployment <name> from jones_deployments.js",
  function(thisArg) {
    deployment = thisArg;
    return 1;
  });

driver.onReportCallback = function() {
  if(this.statsDomain !== null) {
    stats_module.peek(this.statsDomain);
  }
};

driver.onAllTestsCompleteCallback = function(callback) {
  jones.closeAllOpenSessionFactories(callback);
};

/* 
*/
driver.getConnectionProperties = function(adapter) {
  return utilities.getConnectionProperties(adapter, deployment, cmdLineProperties);
};

module.exports = driver;

