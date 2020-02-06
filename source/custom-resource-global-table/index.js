/*********************************************************************************************************************
 * Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 * Licensed under the Apache License Version 2.0 (the 'License').
 * You may not use this file except in compliance with the License.
 * A copy of the License is located at
 *
 *         http://www.apache.org/licenses/
 *
 * or in the 'license' file accompanying this file. This file is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, express or implied. See the License for the
 * specific language governing permissions and limitations under the License.
 *********************************************************************************************************************/

var AWS = require('aws-sdk');

exports.handler = async (e, ctx) =>
{
  try
  {
    var bn = e.ResourceProperties.BaseName;
    var regs = e.ResourceProperties.Regions;
    var ssn = `MARS-${bn}`;
    var dynamodb = new AWS.DynamoDB({region: regs[0]});
    var status = "SUCCESS";
    switch (e.RequestType)
    {
        case "Create":
            var p = {
              GlobalTableName: `mars-${bn}-journal`,
              ReplicationGroup: []
            };
            regs.forEach(r => p.ReplicationGroup.push({ RegionName: r }));
            await dynamodb.createGlobalTable(p).promise();
            break;
        case "Delete":
            var delGTParams = {
              GlobalTableName: `mars-${bn}-journal`,
              ReplicaUpdates: []
            };
            regs.forEach(r => delGTParams.ReplicaUpdates.push({ Delete: { RegionName: r }}));
            await dynamodb.updateGlobalTable(delGTParams).promise();
            break;
        default:
          throw new Error(`Unsupported RequestType: ${e.RequestType}`);
    }
    await sendResult(e, ctx, status, {StackSetName: ssn});
  }
  catch (ex)
  {
    await sendResult(e, ctx, "FAILED", null, ex.message);
  }
};
async function sendResult(e, ctx, rs, rd, rsn) {
  return new Promise(function(resolve) {
      var body = JSON.stringify({
          Status: rs,
          Reason: rsn,
          PhysicalResourceId: ctx.logStreamName,
          StackId: e.StackId,
          RequestId: e.RequestId,
          LogicalResourceId: e.LogicalResourceId,
          NoEcho: false,
          Data: rd
      });
      var h = require("https");
      var u = require("url");
      var p = u.parse(e.ResponseURL);
      var req = h.request({
          hostname: p.hostname,
          port: 443,
          path: p.path,
          method: "PUT",
          headers: {
              "content-type": "",
              "content-length": body.length
          }}, resp => { resolve(); });
      req.write(body);
      req.end();
  });
}
