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
var cloudformation = new AWS.CloudFormation();


exports.handler = async (event, context) => {

    if (event.BaseName == null)
        throw new Error("BaseName is a required property.");
    if (event.Regions == null)
        throw new Error("Regions is a required property.");
    if (event.EnableBucketMetrics == null)
      event.EnableBucketMetrics = JSON.parse(process.env.EnableBucketMetrics);
    if (event.CreateRegionalDashboards == null)
      event.CreateRegionalDashboards = JSON.parse(process.env.CreateRegionalDashboards);

    var supportedRegions = process.env.SupportedRegions.split(',');
    event.Regions.split(',').forEach(region => {
        if (!supportedRegions.includes(region))
            throw new Error(`${region} is not a supported region. Supported regions include: ${supportedRegions.join()}`);
    });


    var describeTasks = [];
    var baseResourceRegions = [];

    event.Regions.split(',').forEach(async region =>  {
        console.log(`ADDING REGION: ${region}`);

            var params = {
              StackName: 'MARS-BaseRegionalResources'
            };
            var regionalCf = new AWS.CloudFormation({region: region});
            var task = regionalCf.describeStacks(params).promise().catch(e => {

                var notExistsErrorCode = `Stack with id ${params.StackName} does not exist`;
                if (notExistsErrorCode == e.message)
                    baseResourceRegions.push(region);
                else console.log(e.message);
            });
            describeTasks.push(task);
     });

    await Promise.all(describeTasks);

    console.log("Base regions to create: ", baseResourceRegions);

    if (baseResourceRegions.length > 0)
    {
        var baseRegionalResourcesStackName = await createBaseRegionalResources(baseResourceRegions, event.CreateRegionalDashboards);
        console.log(`Base regional resources stack name: ${baseRegionalResourcesStackName}`);
        var params = {
          StackName: baseRegionalResourcesStackName
        };
        await cloudformation.waitFor('stackCreateComplete', params).promise();
    }

  var template = {
      Parameters: {
        BaseName : {
            Type: "String"
        },
        Regions: {
            Type: "List<String>"
        },
        Template: {
            Type: "String",
            Default: 'bucket-regional-resources-template.json'
        },
        CodeBucketBaseName: {
          Type: "String",
          Default: process.env.CodeBucketBaseName
        },
        CodeKeyBase: {
          Type: "String",
          Default: process.env.CodeKeyBase
        },
        MetricsConfigurationName: {
            Type: "String",
            Default: "NoMetrics"
        }
      },
      Resources:
      {
          MARSRegionalResources:
          {
              Type: "Custom::MARSRegionalResources",
              Properties: {
                ServiceToken: {"Fn::Sub": "arn:aws:lambda:${AWS::Region}:${AWS::AccountId}:function:MARS-CustomResource-ParallelStackSet"},
                StackName: {"Fn::Sub": "MARS-${BaseName}-RegionalResources"},
                BaseName: {"Ref": "BaseName"},
                Regions: {"Ref": "Regions"},
                Template: {"Ref": "Template"},
                CodeBucketBaseName: {"Ref": "CodeBucketBaseName"},
                CodeKeyBase: {"Ref": "CodeKeyBase"},
                MetricsConfigurationName: {"Ref": "MetricsConfigurationName"}
              }
          },
          MARSGlobalTable: {
            Type: "Custom::MARSGlobalTable",
            Properties: {
                ServiceToken: {"Fn::Sub": "arn:aws:lambda:${AWS::Region}:${AWS::AccountId}:function:MARS-CustomResource-GlobalTable"},
                BaseName: {"Ref": "BaseName"},
                Regions: {"Ref": "Regions"}
            },
            DependsOn: ["MARSRegionalResources"]
          }
      }
  };

  if (event.EnableBucketMetrics)
  {
     var dashboardBody = createDashboard(event);

    template.Resources["Dashboard"] = {
      Type: "AWS::CloudWatch::Dashboard",
      Properties: {
        DashboardName: `MARS-${event.BaseName}`,
        DashboardBody: {"Fn::Sub": dashboardBody }
      },
      DependsOn: ["MARSRegionalResources"]
    };
  }

  var json = JSON.stringify(template);


  var params = {
    StackName: 'MARS-' + event.BaseName,
    Capabilities: ["CAPABILITY_NAMED_IAM"],
    Parameters: [
        {
            ParameterKey: "BaseName",
            ParameterValue: event.BaseName
        },
        {
            ParameterKey: "Regions",
            ParameterValue: event.Regions
        }
        ],
    TemplateBody: json
  };

  if (event.EnableBucketMetrics)
    params.Parameters.push({
            ParameterKey: "MetricsConfigurationName",
            ParameterValue: "EntireBucket"
        });

  await cloudformation.createStack(params).promise();
};

async function createBaseRegionalResources(regions, createRegionalDashboards)
{
      var template = {
      Parameters: {
        Regions: {
            Type: "List<String>",
        },
        Template: {
            Type: "String",
            Default: 'base-regional-resources-template.json'
        },
        CodeBucketBaseName: {
          Type: "String",
          Default: process.env.CodeBucketBaseName
        },
        CodeKeyBase: {
          Type: "String",
          Default: process.env.CodeKeyBase
        },
        ParallelStackSetRoleArn: {
          Type: "String",
          Default: process.env.ParallelStackSetRoleArn
        },
        StreamProcessorRoleArn: {
          Type: "String",
          Default: process.env.StreamProcessorRoleArn
        },
        QueueProcessorRoleArn: {
          Type: "String",
          Default: process.env.QueueProcessorRoleArn
        }
      },
      Resources:
      {
          MARSBaseRegionalResources:
          {
              Type: "Custom::MARSBaseRegionalResources",
              Properties: {
                ServiceToken: {"Fn::Sub": "arn:aws:lambda:${AWS::Region}:${AWS::AccountId}:function:MARS-CustomResource-ParallelStackSet"},
                StackName: "MARS-BaseRegionalResources",
                Regions: {"Ref": "Regions"},
                Template: {"Ref": "Template"},
                CodeBucketBaseName: {"Ref": "CodeBucketBaseName"},
                CodeKeyBase: {"Ref": "CodeKeyBase"},
                ParallelStackSetRoleArn: {"Ref": "ParallelStackSetRoleArn"},
                StreamProcessorRoleArn: {"Ref": "StreamProcessorRoleArn"},
                QueueProcessorRoleArn: {"Ref": "QueueProcessorRoleArn"}
              }
          }
      }
  };

  if (createRegionalDashboards)
  {
    template.Parameters.DashboardSourceFile = {
            Type: "String",
            Default: "base-regional-resources-dashboard.json"
        };
    template.Resources.MARSBaseRegionalResources.Properties.DashboardSourceFile = {"Ref": "DashboardSourceFile"};
  }

  var json = JSON.stringify(template);
  var regionalBaseResourceStackName = `MARS-BaseRegionalResources-${Date.now()}`;

  var params = {
    StackName: regionalBaseResourceStackName,
    Capabilities: ["CAPABILITY_NAMED_IAM"],
    Parameters: [
        {
            ParameterKey: "Regions",
            ParameterValue: regions.join()
        }
        ],
    TemplateBody: json
  };

  await cloudformation.createStack(params).promise();

    return regionalBaseResourceStackName;
}

function createDashboard(event)
{
        // TODO: create dynamic dashboard.
    var dashboard = {
      widgets: []
    };

    var w = 24;
    var titleHeight = 1;
    var titleWithDescriptionHeight = 2;
    var chartHeight = 6;
    var singleValueHeight = 3;
    var y = 0; // starting point

    dashboard.widgets.push({
      type: "text",
      x: 0,
      y: y,
      width: w,
      height: titleHeight,
      properties: {
          markdown: "\n## Requests\n"
      }
    });

    y+=titleHeight;

    event.Regions.split(',').forEach(r => {

      dashboard.widgets.push({
          "type": "metric",
          "x": 0,
          "y": y,
          "width": w,
          "height": chartHeight,
          "properties": {
              "metrics": [
                  [ "AWS/S3", "GetRequests", "BucketName", "mars-" + event.BaseName + "-" + r, "FilterId", "EntireBucket", { "visible": true } ],
                  [ ".", "ListRequests", ".", ".", ".", "." ],
                  [ ".", "PostRequests", ".", ".", ".", "." ],
                  [ ".", "HeadRequests", ".", ".", ".", "." ],
                  [ ".", "AllRequests", ".", ".", ".", "." ],
                  [ ".", "DeleteRequests", ".", ".", ".", "." ]
              ],
              "view": "timeSeries",
              "stacked": false,
              "region": r,
              "stat": "Sum",
              "period": 60,
              "title": r
          }
      });

      y+=chartHeight;
    });

    dashboard.widgets.push({
      type: "text",
      x: 0,
      y: y,
      width: w,
      height: titleHeight,
      properties: {
          markdown: "\n## Bytes\n"
      }
    });

    y+=titleHeight;


    event.Regions.split(',').forEach(r => {

       dashboard.widgets.push(
           {
            "type": "metric",
            "x": 0,
            "y": y,
            "width": w,
            "height": chartHeight,
            "properties": {
                "metrics": [
                    [ "AWS/S3", "BytesDownloaded", "BucketName", "mars-" + event.BaseName + "-" + r, "FilterId", "EntireBucket" ],
                    [ ".", "BytesUploaded", ".", ".", ".", "." ]
                ],
                "view": "timeSeries",
                "stacked": false,
                "region": r,
                "stat": "Sum",
                "period": 60,
                "title": r,
                "yAxis": {
                    "left": {
                        "min": 0
                    }
                }
            }
        });
        y+=chartHeight;
    });

    dashboard.widgets.push({
      type: "text",
      x: 0,
      y: y,
      width: w,
      height: titleHeight,
      properties: {
          markdown: "\n## Latency\n"
      }
    });

    y+=titleHeight;

    event.Regions.split(',').forEach(r => {
       dashboard.widgets.push(
           {
            "type": "metric",
            "x": 0,
            "y": y,
            "width": w,
            "height": chartHeight,
            "properties": {
                "metrics": [
                    [ "AWS/S3", "TotalRequestLatency", "BucketName", "mars-" + event.BaseName + "-" + r, "FilterId", "EntireBucket", { "id": "m6", "stat": "Minimum" } ],
                    [ "...", { "id": "m1", "stat": "Average" } ],
                    [ "...", { "id": "m5" } ],
                    [ ".", "FirstByteLatency", ".", ".", ".", ".", { "id": "m3", "stat": "Minimum" } ],
                    [ "...", { "id": "m4", "stat": "Average" } ],
                    [ "...", { "id": "m2" } ]
                ],
                "view": "timeSeries",
                "stacked": false,
                "region": r,
                "title": r,
                "stat": "Maximum",
                "period": 60
            }
        });
        y+=chartHeight;
    });

    dashboard.widgets.push({
      type: "text",
      x: 0,
      y: y,
      width: w,
      height: titleHeight,
      properties: {
          markdown: "\n## Errors\n"
      }
    });

    y+=titleHeight;

    event.Regions.split(',').forEach(r => {
       dashboard.widgets.push(
            {
            "type": "metric",
            "x": 0,
            "y": y,
            "width": w,
            "height": chartHeight,
            "properties": {
                "metrics": [
                    [ "AWS/S3", "5xxErrors", "BucketName", "mars-" + event.BaseName + "-" + r, "FilterId", "EntireBucket" ],
                    [ ".", "4xxErrors", ".", ".", ".", "." ]
                ],
                "view": "timeSeries",
                "stacked": false,
                "region": r,
                "title": r,
                "stat": "Sum",
                "period": 60
            }
        });
        y+=chartHeight;
    });

    dashboard.widgets.push(        {
            "type": "text",
            "x": 0,
            "y": y,
            "width": w,
            "height": titleWithDescriptionHeight,
            "properties": {
                "markdown": "\n## Storage\nNote these metrics are only available at 1 day fidelity or more. Storage stats are updated daily.\n"
            }
        });

    y+=titleWithDescriptionHeight;

    event.Regions.split(',').forEach(r => {
       dashboard.widgets.push(
            {
            "type": "metric",
            "x": 0,
            "y": y,
            "width": w,
            "height": singleValueHeight,
            "properties": {
                "metrics": [
                    [ "AWS/S3", "BucketSizeBytes", "StorageType", "StandardStorage", "BucketName", "mars-" + event.BaseName + "-" + r ],
                    [ ".", "NumberOfObjects", ".", "AllStorageTypes", ".", "." ]
                ],
                "view": "singleValue",
                "region": r,
                "stacked": false,
                "period": 86400,
                "stat": "Average",
                "title": r
            }
        });
        y+=singleValueHeight;
    });

   var dashboardBody = JSON.stringify(dashboard);

   return dashboardBody;
}
