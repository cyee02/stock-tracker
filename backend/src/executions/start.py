import boto3
from boto3.dynamodb.types import TypeSerializer
import finnhub
import config
from tabulate import tabulate
from publish import publish
from executions.execute import get_latest_sma

# Initiate clients
events_client = boto3.client('events')
ddb_client = boto3.client('dynamodb')
finnhub_client = finnhub.Client(api_key=config.API_KEY)

serializer = TypeSerializer()

def start_lambda_actions(stock_list):
  print("Starting recurrent execution")
  events_client.enable_rule(Name="ExecuteLambdaEvent")
  publish_initial_review(stock_list)
  reset_alert(stock_list)

def publish_initial_review(stock_list):
  recommendation_headers = ["Stock Code", "Buy", "Hold", "Period", "Sell", "Strong-Buy", "Strong-Sell"]
  sma_headers = ["Company", "Current Price", "SMA-30days", "30day-difference(%)", "SMA-120days", "120day-difference(%)"]
  recommendations=[]
  sma_summary_data=[]

  for stock in stock_list:
    # Make recommendation tables
    trends = finnhub_client.recommendation_trends(stock['code'])
    latest_trend = list(trends[0].values())
    latest_trend.insert(0, latest_trend.pop(-1))
    recommendations.append(latest_trend)

    # Make SMA table
    sma_30 = round(get_latest_sma(stock["code"], 30), 2)
    sma_120 = round(get_latest_sma(stock["code"], 120), 2)
    current_price = finnhub_client.quote(stock["code"])['c']
    diff_30 = round(((current_price - sma_30)/current_price) *100, 2)
    diff_120 = round(((current_price - sma_120)/current_price) *100, 2)
    sma_summary_data.append([stock["code"], current_price, sma_30, diff_30, sma_120, diff_120])

  # Make email message
  message = """
  <html><body><p>Hello, Investor!</p>
  <p>Here is the summary based on SMA:</p>
  {sma_table}
  <p><br>Here are the analysts' recommendations this month!</p>
  {rec_table}
  <p>Regards,</p>
  <p>Your Robo Tracker</p>
  </body></html>
  """
  message = message.format(
    sma_table=tabulate(sma_summary_data, headers=sma_headers, tablefmt="html", colalign="center"),
    rec_table=tabulate(recommendations, headers=recommendation_headers, tablefmt="html", colalign="center")
  )
  publish(message, "html", "Stock Recommendation")
  return True

def reset_alert(stock_list):
  for stock in stock_list:
    for period in stock["alert_sent"]:
      stock["alert_sent"][period] = False
    serialized_data = serializer.serialize(stock)["M"]
    ddb_client.put_item(
      TableName=config.DAILY_MA_TABLE,
      Item=serialized_data
    )