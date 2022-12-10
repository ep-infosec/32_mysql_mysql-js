/*
 Copyright (c) 2014, 2016Oracle and/or its affiliates. All rights
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

/** This is the smoke test for the json suite.
 */

var test = new harness.SmokeTest("SmokeTest");

test.run = function() {
  var t = this;
  sqlCreate(this.suite, function(error) {
    if (error) {
      t.skip('createSQL failed: ' + error);
    } else {
      global.fail_openSession(t, function(session) {
        if (session) {
          t.pass();
        } else {
          t.fail('json SmokeTest openSession failed.');
        }
      });
    }
  });
};

module.exports.tests = [test];
