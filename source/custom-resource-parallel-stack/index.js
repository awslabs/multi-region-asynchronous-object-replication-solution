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
    console.log(e);
    var sn = e.ResourceProperties.StackName;
    var regs = e.ResourceProperties.Regions;
    var status = "SUCCESS";
    var promises = [];
    switch (e.RequestType)
    {
        case "Create":
            console.log(`Template: ${e.ResourceProperties.Template}`);
            var templateSource = getStringFromFile(e.ResourceProperties.Template);
              console.log("Template Source: ", templateSource);
            var t = JSON.parse(templateSource);
            console.log("t", t);
            var cfParams = [];
            if (t.Parameters && e.ResourceProperties)
            {
              Object.keys(e.ResourceProperties).forEach(propKey => {
                var propValue = e.ResourceProperties[propKey];
                if (propKey == "DashboardSourceFile")
                {
                  var dashboardBody = getStringFromFile(propValue).toString('utf8');
                  t.Resources["Dashboard"] = {
                    Type: "AWS::CloudWatch::Dashboard",
                    Properties: {
                      DashboardName: {"Fn::Sub": "${DashboardName}-${AWS::Region}"},
                      DashboardBody: {"Fn::Sub": dashboardBody }
                    }
                  };
                }
                else if (propValue && t.Parameters[propKey])
                  cfParams.push({
                    ParameterKey: propKey,
                    ParameterValue: propValue
                  });
              });
            }
            var template = JSON.stringify(t);

            var createParams = {
              StackName: sn,
              Capabilities: [ "CAPABILITY_IAM", "CAPABILITY_NAMED_IAM" ],
              Parameters: cfParams,
              TemplateBody: template,
            };
            console.log("createParams", createParams);
            promises = [];
            regs.forEach(r => {
              var cf = new AWS.CloudFormation({region: r});
              promises.push(cf.createStack(createParams).promise());
            });
            await Promise.all(promises);
            promises = [];
            regs.forEach(r => {
              var cf = new AWS.CloudFormation({region: r});
              promises.push(cf.waitFor('stackCreateComplete', {StackName: sn}).promise());
            });
            await Promise.all(promises);
            break;
        case "Delete":
            promises = [];
            regs.forEach(r => {
            var cf = new AWS.CloudFormation({region: r});
                promises.push(cf.deleteStack({StackName: sn}).promise());
            });
            await Promise.all(promises);
            promises = [];
            regs.forEach(r => {
            var cf = new AWS.CloudFormation({region: r});
                promises.push(cf.waitFor('stackDeleteComplete', {StackName: sn}).promise());
            });
            await Promise.all(promises);
            break;
        default:
          throw new Error(`Unsupported RequestType: ${e.RequestType}`);
    }
    await sendResult(e, ctx, status, {StackSetName: sn});
  }
  catch (ex)
  {
    await sendResult(e, ctx, "FAILED", null, ex.message);
  }
};

function getStringFromFile(fileName) {
  const fs = require('fs');
  let rawdata = fs.readFileSync(fileName);
  return rawdata;
}

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
