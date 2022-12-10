/*
 Copyright (c) 2014, 2016, Oracle and/or its affiliates. All rights
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
var util    = require("util");
var udebug  = unified_debug.getLogger("json/IncludeFieldTest.js");
var jones   = require("database-jones");
var Meta    = require(jones.api.Meta);

function Semistruct(id, name, number, a, c) {
  if (id !== undefined) {
    this.id = id;
    this.name = name;
    this.number = number;
    this.a = a;
    this.c = c;
  }
}

// The problem here is that we have no way to define a converter on
// the shared column
var t2 = new harness.ConcurrentTest("WriteSemistructIncludeTest");
t2.run = function() {
  var testCase = this;
  var semistructMapping = new jones.TableMapping('json_semistruct');
  semistructMapping.mapField('id');
  semistructMapping.mapField('name');
  semistructMapping.mapField('number');
  semistructMapping.mapField('a', 'SPARSE_FIELDS', Meta.shared());
  semistructMapping.mapField('b', 'SPARSE_FIELDS', Meta.shared());

  semistructMapping.applyToClass(Semistruct);

  testCase.mappings = Semistruct;
  
  var semistruct20 = new Semistruct(20, 'Name 20', 20, [{a200: 'a200'}, {a201: 'a201'}], 'ignored  because c is not included');
  fail_openSession(testCase, function(session) {
    testCase.session = session;
  })
  .then(function() {
    testCase.session.persist(semistruct20);
  })
  .then(function() {
    return testCase.session.find(Semistruct, 20);
  })
  .then(function(found) {
    // verify found
    udebug.log(testCase.name, " found: " + util.inspect(found));
    testCase.errorIfNotEqual('\n' + testCase.name + " failed to verify id", 20, found.id);
    testCase.errorIfNotEqual('\n' + testCase.name + " failed to verify name", 'Name 20', found.name);
    testCase.errorIfNotEqual('\n' + testCase.name + " failed to verify number", 20, found.number);
    if (Array.isArray(found.a)) {
      if (found.a.length === 2) {
        testCase.errorIfNotEqual('\n' + testCase.name + " failed to verify a[0].a200", 'a200', found.a[0].a200);
        testCase.errorIfNotEqual('\n' + testCase.name + " failed to verify a[1].a201", 'a201', found.a[1].a201);
      } else {
        testCase.error('\n' + testCase.name + " array a has wrong length; expected: 2, actual: " + found.a.length);
      }
    } else {
      testCase.error('\n' + testCase.name + " failed to load property a.");
    }
    if (found.c) {
      testCase.error('\n' + testCase.name + ' incorrectly loaded property c.');
    }
  })
  // clean up and report errors
  .then(function() {
    return testCase.session.close();
  })
  .then(function() {testCase.failOnError();}, function(err) {testCase.fail(err);}
  );
};



exports.tests = [t2];
