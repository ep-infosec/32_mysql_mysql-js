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

var Driver = require("..").Driver;

var driver = new Driver();

driver.processCommandLineOptions();

driver.addSuitesFromDirectory(".");
driver.addLintTestsForDirectory("../lib");

driver.ignoreLint("Driver.js", 14,
  "Expected a conditional expression and instead saw an assignment.");

driver.ignoreLint("LintTest.js", 14,
  "Expected a conditional expression and instead saw an assignment.");

driver.ignoreLint("Test.js", 21, "Expected a string and instead saw");

driver.runAllTests();

