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
var sqs = new AWS.SQS();
var s3 = new AWS.S3();
var dynamodb = new AWS.DynamoDB();


async function processRecord(record) {
    try
    {
        //console.log(record);

        var localRegion = process.env.AWS_REGION;
        var bucketBaseName = record.eventSourceARN.split('/')[1].replace("-journal", "");
        var localBucketName = `${bucketBaseName}-${localRegion}`;
        var key = record.dynamodb.Keys.Key.S;
        var item = null;
        switch (record.eventName)
        {
            case "INSERT":
            case "MODIFY":
                item = record.dynamodb.NewImage;
                break;
            case "REMOVE":
                return; // don't process records that are removed.
        }
        // the first write doesn't contain the replication metadata so throw this record away.
        // we are only processing records that have been processed by MMB tables first.
        if (!item.hasOwnProperty("aws:rep:updateregion"))
            return;
        var updateRegion = item["aws:rep:updateregion"].S;
        // don't process local changes.
        if (updateRegion == localRegion)
            return;
        //console.log(item);
        var eventName = item.EventName.S;
        if (eventName.startsWith("ObjectCreated"))
        {
            var remoteBucketName = `${bucketBaseName}-${updateRegion}`;
            var copyParams = {
              Bucket: localBucketName,
              CopySource: "/" + remoteBucketName + "/" + item.EncodedKey.S,
              Key: key
             };
             var size = parseInt(item.Size.N);
             if (size > 16000000)
             {
                 await createMultipartUpload(localBucketName, remoteBucketName, item);
             } else
             {
                var copyResult = await s3.copyObject(copyParams).promise();
                console.log("COPY DONE", copyResult);
             }
        }
        else if (eventName.startsWith("ObjectRemoved"))
        {
            var deleteParams = {Bucket: localBucketName, Key: key};

            var deleteResult = await s3.deleteObject(deleteParams).promise();
            console.log("DELETE DONE", deleteResult);
        }
    }
    catch (Ex)
    {
        console.log("ERROR");
        console.log(Ex);
    }
}
exports.handler = async (event) => {
    var promises = [];
    console.log(`Processing number of records: ${event.Records.length}`);
    event.Records.forEach(record => {
        promises.push(processRecord(record));
    });
    await Promise.all(promises);
};

async function createMultipartUpload(localBucketName, remoteBucketName, item) {
  
     console.log("Processing multipart upload.");

     var key = item.Key.S;
     var journalItemHash = `${item.Key.S}|${item.EventName.S}|${item.Region.S}|${item.Size.N}|${item.Time.N}|${item.Source.S}|${item.Principal.S}|${item.IPAddress.S}`;// md5(JSON.stringify(item));
     
    var updateObjectParams = {
        Key: {
            Key: { S: key },
            JournalItemHash: { S: journalItemHash }
        },
        TableName: process.env.MultiPartUploadsTableName,
        ReturnValues: "ALL_NEW"
    };
     
    var updateObjectResult = await dynamodb.updateItem(updateObjectParams).promise();
     
     if (updateObjectResult.Attributes.UploadId)
     {
         // Stop processing because this is a duplicate message that has alredy started an upload.
         console.log(`Skipping duplicate message: ${journalItemHash}`);
         return; 
     }
     
     var createParams = {
         Bucket: localBucketName,
         Key: key
     };
     var createResult = await s3.createMultipartUpload(createParams).promise();

     var partSize = 16000000; // 16 MB
     
     var size = parseInt(item.Size.N);
     if (size >= 1000000000) // 1 GB
        partSize = 32000000; // 32 MB
     
     var previousLocation = 0;
     var part = 1;

     var sizeLeft = size;
     var messages = [];
     while (sizeLeft > 0)
     {
         var length = partSize;
         if (sizeLeft < partSize)
            length = sizeLeft;
         var stop = previousLocation + length;
         var first = previousLocation;
         var last = stop -1;
         var uploadPartParams = {
          Bucket: localBucketName,
          Key: key,
          PartNumber: part,
          CopySourceRange: `bytes=${first}-${last}`,
          CopySource: "/" + remoteBucketName + "/" + item.EncodedKey.S,
          UploadId: createResult.UploadId
         };
         var sendMessageParams = {
              MessageBody: JSON.stringify(uploadPartParams),
              QueueUrl: process.env.QueueUrl,
             MessageAttributes: {
               EventName: { DataType: "String", StringValue: "UploadPartCopy" },
               JournalItemHash: {DataType: "String", StringValue: journalItemHash }
              }
            };
         messages.push(sendMessageParams);
         part++;
         previousLocation += length;
         sizeLeft -= length;
     }
     
    const secondsInADay = 86400;
    var secondsInWeek = secondsInADay * 7;
    var time = Math.floor(new Date() / 1000);
    var ttl = (time + secondsInWeek).toString();
    
    var pubObjParams = {
      Item: {
       "Key": {S: key},
       "JournalItemHash": {S: journalItemHash },
       "UploadId": { S: createResult.UploadId },
       "ProcessingAttempts": {N: "0"},
       "TotalParts": {N: (part - 1).toString()},
       "MaxPartSize": {N: partSize.toString()},
       "RemoteBucket": {S: remoteBucketName},
       "LocalBucket": {S: localBucketName},
       "Expire": {N: ttl},
       "QueuedForProcessing": {S: (new Date()).toString()},
       "Status": {S: "Queued"}
      },
      TableName: process.env.MultiPartUploadsTableName
     };
     await dynamodb.putItem(pubObjParams).promise();
     
     var promises = [];
     messages.forEach(sendMessageParams => {
         promises.push(sqs.sendMessage(sendMessageParams).promise());
     });
     await Promise.all(promises);
     
}