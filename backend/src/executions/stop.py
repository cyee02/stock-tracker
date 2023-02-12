import boto3
import finnhub
import config
from tabulate import tabulate
from publish import publish
from executions.execute import get_latest_sma

events_client = boto3.client('events')
finnhub_client = finnhub.Client(api_key=config.API_KEY)

def stop_lambda_actions(stock_list):
  print("Stopping recurrent execution")
  publish_summary(stock_list)
  events_client.disable_rule(Name="ExecuteLambdaEvent")
  return True

def publish_summary(stock_list):
  stock_headers = ["Company", "Current Price", "Difference", "Difference(%)", "Day-High", "Day-Low", "Day-Open", "Previous-Close"]
  sma_headers = ["Company", "Current Price", "SMA-30days", "30day-difference(%)", "SMA-120days", "120day-difference(%)"]
  stock_summary_data = []
  sma_summary_data = []
  for stock in stock_list:
    # Stock summary
    quote = finnhub_client.quote(stock["code"])
    quote_lst = list(quote.values())
    quote_lst = [round(quote, 2) for quote in quote_lst] # Round the values
    quote_lst.insert(0, stock["code"]) #Insert stock code
    del quote_lst[-1] #remove time stamp
    stock_summary_data.append(quote_lst)

    # SMA summary >> to implement dynamic input for periods
    sma_30 = round(get_latest_sma(stock["code"], 30), 2)
    sma_120 = round(get_latest_sma(stock["code"], 120), 2)
    current_price = quote_lst[1]
    diff_30 = round(((current_price - sma_30)/current_price) *100, 2)
    diff_120 = round(((current_price - sma_120)/current_price) *100, 2)
    sma_summary_data.append([stock["code"], current_price, sma_30, diff_30, sma_120, diff_120])

  message = """
  <html><body><p>Hello, Investor!</p>
  <p>Here is the summary of your stocks performance today:</p>
  {stock_summary}
  <p><br>Here is the summary based on SMA:</p>
  {sma_summary}
  <p>Regards,</p>
  <p>Your Robo Tracker</p>
  </body></html>
  """
  message = message.format(
    stock_summary=tabulate(stock_summary_data, headers=stock_headers, tablefmt="html", colalign="center"),
    sma_summary=tabulate(sma_summary_data, headers=sma_headers, tablefmt="html", colalign="center")
  )
  publish(message, "html", "Stock Summary")