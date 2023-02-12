import time

# configuration
app_name = "stock-tracker-api"
version = str(int(time.time()))
bucket_name = "moving-average-tracker-bucket"

stack_params = {
  "BucketName": bucket_name,
  "Version": version
}

# Printing out to write parameter to cloudformation CLI
stack_parameters = ""
for key in stack_params:
  stack_parameters += f"{key}={stack_params[key]} "

print(f"STACK_PARAMETERS='{stack_parameters}'; APP_NAME={app_name}; VERSION={version}; BUCKET={bucket_name}")