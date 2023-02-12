import boto3
import finnhub
import config
import pytz
from datetime import datetime, timedelta
from publish import publish
from boto3.dynamodb.types import TypeSerializer

finnhub_client = finnhub.Client(api_key=config.API_KEY)
ddb_client = boto3.client('dynamodb')
serializer = TypeSerializer()

def execute(stock_list):
  print("Executing moving average tracker")

  for stock in stock_list:
    print("stock", stock)
    latest_price = finnhub_client.quote(stock["code"])['c']
    for period in stock["period"]:
      latest_sma = get_latest_sma(stock["code"], period)
      stock_input = {
        "code": stock["code"],
        "period": period,
        "trend": stock["trend"][period],
        "alert_sent": stock["alert_sent"][period],
      }
      process_sma(latest_price, latest_sma, stock_input, stock)
  return True

def get_latest_sma(code, period):
  to_time = datetime.now()
  from_time = datetime.now() - timedelta(200)
  data = finnhub_client.technical_indicator(
    symbol=code,
    resolution='D',
    _from=from_time.strftime("%s"),
    to=to_time.strftime("%s"),
    indicator='sma',
    indicator_fields={"timeperiod": period}
  )
  return round(data['sma'][-1], 2)

def process_sma(latest_price, latest_sma, stock_input, stock_full):
  et_now = datetime.now(tz=pytz.timezone('US/Eastern')).strftime("%d %b %Y, %H:%M:%S")
  sgt_now = datetime.now(tz=pytz.timezone('Asia/Singapore')).strftime("%d %b %Y, %H:%M:%S")

  alert = False
  message = ""

  # Alert when latest price has crossed SMA
  if latest_price > latest_sma and stock_input["trend"] == "bear" and not stock_input["alert_sent"]:
    alert = True
    stock_full["trend"][stock_input["period"]] = "bull"
    stock_full["alert_sent"][stock_input["period"]] = True
    message = f"""
      Hello Investor!


      Company {stock_input["code"]} has crossed above the {stock_input["period"]} daily moving average line. It is time to consider buying!
    """
  elif latest_price < latest_sma and stock_input["trend"] == "bull" and not stock_input["alert_sent"]:
    alert = True
    stock_full["trend"][stock_input["period"]] = "bear"
    stock_full["alert_sent"][stock_input["period"]] = True
    message = f"""
      Hello Investor!


      Company {stock_input["code"]} has crossed below the {stock_input["period"]} daily moving average line. It is time to consider selling!

    """
  else:
    if stock_input["alert_sent"]:
      print("Alert has already been sent today")
    else:
      print("No change in trend, no alert is sent")

  message += f"""
      Latest Price: {latest_price}
      Latest SMA: {latest_sma}
      Time (ET): {et_now}
      Time (SGT): {sgt_now}
  """

  print("Updating with new data: ", stock_full)
  serialized_data = serializer.serialize(stock_full)["M"]
  ddb_client.put_item(
    TableName=config.DAILY_MA_TABLE,
    Item=serialized_data
  )

  if alert:
    # Send out alert
    publish(message, "text", "Alert for {code} triggered".format(code = stock_input["code"]))

    # Update ddb
    print("Updating with new data: ", stock_full)
    serialized_data = serializer.serialize(stock_full)["M"]
    ddb_client.put_item(
      TableName=config.DAILY_MA_TABLE,
      Item=serialized_data
    )