# To utilize libraries in lib subfolder
import lib

import boto3
from boto3.dynamodb.types import TypeDeserializer
import config

# Import from local
from executions.start import start_lambda_actions
from executions.execute import execute
from executions.stop import stop_lambda_actions

deserializer = TypeDeserializer()
ddb_client = boto3.client('dynamodb')

def main(event, context):
  # Get stock information from ddb
  stock_list = ddb_client.scan(TableName = config.DAILY_MA_TABLE)["Items"]
  for i in range(0, len(stock_list)):
      stock_list[i] = deserializer.deserialize({'M': stock_list[i]})

  print("Lambda function started with event: ", event)
  if "StartLambdaEvent" in event["resources"][0]:
    start_lambda_actions(stock_list)
  elif "StopLambdaEvent" in event["resources"][0]:
    stop_lambda_actions(stock_list)
  elif "ExecuteLambdaEvent" in event["resources"][0]:
    execute(stock_list)
  else:
    print("Do nothing")
  return True


# # Testing purposes
# event = {
#   "resources": [
#     # "arn:aws:events:ap-southeast-1:332952050502:rule/StartLambdaEvent"
#     # "arn:aws:events:ap-southeast-1:332952050502:rule/ExecuteLambdaEvent"
#     "arn:aws:events:ap-southeast-1:332952050502:rule/StopLambdaEvent"
#   ]
# }
# main(event, "")