import boto3
from boto3.dynamodb.types import TypeSerializer

codes = ["NVDA", "TSLA", "AAPL", "SE", "SQ", "PLTR", "MSFT"]
ddb_client = boto3.client('dynamodb')
serializer = TypeSerializer()

for code in codes:
  data = {
    "code": code,
    "trend": {
      "30": "bull",
      "120": "bull"
    },
    "period": ["30", "120"],
    "alert_sent": {
      "30": False,
      "120": False
    },
  }
  serialized_data = serializer.serialize(data)["M"]
  ddb_client.put_item(
    TableName='dailyMovingAverage',
    Item=serialized_data
  )
