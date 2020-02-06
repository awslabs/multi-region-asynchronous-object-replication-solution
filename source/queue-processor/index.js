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
var dynamodb = new AWS.DynamoDB();
var s3 = new AWS.S3();

async function uploadPartCopy(record) {
    var createPartParams = JSON.parse(record.body);
    console.log(createPartParams);
    var createPartResp = await s3.uploadPartCopy(createPartParams).promise();
    var etag = createPartResp.CopyPartResult.ETag;
    var journalItemHash = record.messageAttributes.JournalItemHash.stringValue;
    
     // if we made it this far we will count this upload as a success, so update the statistics.
        var updateObjectParams = {
        ExpressionAttributeNames: {
            "#ProcessingAttempts": "ProcessingAttempts",
            "#Part": `P${createPartParams.PartNumber}`,
            "#LastProcessed": "LastProcessed",
            "#Status": "Status"
        },
        ExpressionAttributeValues: {
            ":processingAttempts": { N: "1" },
            ":part": {  S: etag },
            ":lastProcessed": {  S: (new Date()).toString()  },
            ":status": { S: "Processing" }
        },
        Key: {
            Key: { S: createPartParams.Key },
            JournalItemHash: { S: journalItemHash }
        },
        TableName: process.env.MultiPartUploadsTableName,
        UpdateExpression: "SET #Part = :part, #LastProcessed = :lastProcessed, #Status = :status ADD #ProcessingAttempts :processingAttempts",
        ReturnValues: "ALL_NEW"
    };
    
     var updateObjectResult = await dynamodb.updateItem(updateObjectParams).promise();
 
     var totalParts = parseInt(updateObjectResult.Attributes.TotalParts.N);
     var p = 1;
     var etags = [];
     
     while (p <= totalParts)
     {
        var partName = `P${p}`;
        var partAttribute = updateObjectResult.Attributes[partName];
        console.log(partAttribute);
        if (partAttribute)
            etags.push(partAttribute.S);
        p++;
     }
     if (etags.length == totalParts)
     {
        var completeUploadParams = {
          Bucket: updateObjectResult.Attributes.LocalBucket.S,
          Key: updateObjectResult.Attributes.Key.S,
          MultipartUpload: {
           Parts: []
          },
          UploadId: updateObjectResult.Attributes.UploadId.S
         };
         
         p = 1;
         etags.forEach(etag => {
            completeUploadParams.MultipartUpload.Parts.push({
                ETag: etag,
                PartNumber: p
            }); 
            p++;
         });
         
        //console.log("COMPLETE Params:", JSON.stringify(completeUploadParams));
         var completeResult = await s3.completeMultipartUpload(completeUploadParams).promise();
         //console.log("UPLOAD COMPLETE", JSON.stringify(completeResult));
         
         updateObjectParams = {
            ExpressionAttributeNames: {
                "#ProcessingFinished": "ProcessingFinished",
                "#ObjectETag": "ObjectETag",
                "#Status": "Status"
            },
            ExpressionAttributeValues: {
                ":processingFinished": {  S: (new Date()).toString()  },
                ":objectEtag": { S: completeResult.ETag }, 
                ":status": { S: "Complete" }
            },
            Key: {
                Key: { S: createPartParams.Key },
                JournalItemHash: { S: journalItemHash }
            },
            TableName: process.env.MultiPartUploadsTableName,
            UpdateExpression: "SET #ProcessingFinished = :processingFinished, #ObjectETag = :objectEtag, #Status = :status",
        };
        await dynamodb.updateItem(updateObjectParams).promise();
     }
}

async function processS3Event(s3Event) {
    console.log("s3Event", s3Event);
    // Don't journal changes that are processed by MARS functions. VERY important, else messages would process in an endless loop.
    if (s3Event.userIdentity.principalId.includes("MARS"))
        return;
    var bucket = s3Event.s3.bucket.name;
    var key = s3Event.s3.object.key;
    var region = s3Event.awsRegion;
    var eventType = s3Event.eventName;
    var eventTime = Date.parse(s3Event.eventTime) / 1000;
    key = decodeURIComponent((key+'').replace(/\+/g, '%20'));
    var tableName = bucket.replace("-" + region, "-journal");
    var dynamodb = new AWS.DynamoDB();
    const secondsInADay = 86400;
    var time = Math.floor(new Date() / 1000);
    var ttl = (time + secondsInADay).toString();
    var putParams = {
        Item: {
            "Key": {
                S: key
            },
            "EncodedKey":
            {
                S: s3Event.s3.object.key
            },
            "EventName": {
              S: eventType
            },
            "Time":
            {
                N: eventTime.toString()
            },
            "Expire":
            {
                N: ttl
            },
            "Region":
            {
                S: s3Event.awsRegion
            },
            "Principal": {
                S: s3Event.userIdentity.principalId
            },
            "IPAddress": {
                S: s3Event.requestParameters.sourceIPAddress
            },
            "Source": {
                S: s3Event.eventSource
            }
        },
        TableName: tableName
    };
    if (eventType.startsWith('ObjectCreated'))
        putParams.Item.Size = {
                N: s3Event.s3.object.size.toString()
            };
    await dynamodb.putItem(putParams).promise();
}


exports.handler = async (event) => {
    

    var promises = [];
    event.Records.forEach(record => {
        
        console.log("RECORD:", JSON.stringify(record));
        
        if (record.messageAttributes.EventName)
            switch(record.messageAttributes.EventName.stringValue) {
                case "UploadPartCopy":
                    promises.push(uploadPartCopy(record));
                    break;
                //case "CheckStatus":
                //    promises.push(checkStatus(record));
                //    break;
            }
        else {
            var s3BatchEvent = JSON.parse(record.body);
            if (s3BatchEvent.Event == "s3:TestEvent")
                return;
            s3BatchEvent.Records.forEach(s3Event => {
               promises.push(processS3Event(s3Event));
            });
        }
    });
    await Promise.all(promises);

    

};
