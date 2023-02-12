from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
import boto3
from botocore.exceptions import ClientError
import config

def publish(message, type, subject):
  ses_client = boto3.client('ses')
  if type == "text": 
    message = MIMEMultipart("alternative", None, [MIMEText(message)])
  else:
    message = MIMEMultipart("alternative", None, [MIMEText(message, type)])

  message['Subject'] = subject
  message['From'] = "MovingAverageTracker <robomovingtracker@gmail.com>"
  # message['To'] = "chiazy94@gmail.com; clarisc@hotmail.com; zheyuann@gmail.com"
  message['To'] = "chiazy94@gmail.com"
  try:
    #Provide the contents of the email.
    response = ses_client.send_raw_email(
        Source="MovingAverageTracker <robomovingtracker@gmail.com>",
        Destinations=[
            # "clarisc@hotmail.com",
            # "zheyuann@gmail.com",
            "chiazy94@gmail.com"
        ],
        RawMessage={
            'Data':message.as_string(),
        },
    )
  # Display an error if something goes wrong.
  except ClientError as e:
      print(e.response['Error']['Message'])
  else:
      print("Email successfully sent! Message ID:", response['MessageId']),
  return True