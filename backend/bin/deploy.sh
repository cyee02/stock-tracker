# chmod +x bin/deploy

#!/bin/bash

CURRENT_DIR=$(pwd)
# ROOT_DIR="$( dirname "${BASH_SOURCE[0]}" )"/..
OUTPUT=$(python3 ${CURRENT_DIR}/bin/config.py)
echo $CURRENT_DIR

eval $OUTPUT

echo $APP_NAME
echo $VERSION
echo $BUCKET
echo $STACK_PARAMETERS

# Install dependencies
# rm -r $CURRENT_DIR/src/lib
# mkdir $CURRENT_DIR/src/lib
echo "Installing dependencies..."
python3 -m pip install -r $CURRENT_DIR/bin/dependencies.txt -t $CURRENT_DIR/src/lib

# # Package source code
# echo "Packaging deployment..."
# rm -r staging
# mkdir staging
# cd src/lib
# zip -r $CURRENT_DIR/staging/requestLambda-$VERSION.zip .
# cd ..
# zip -r $CURRENT_DIR/staging/requestLambda-$VERSION.zip . -x lib

# Package source code
echo "Packaging deployment..."
rm -r staging
mkdir staging
cd src
zip -r $CURRENT_DIR/staging/requestLambda-$VERSION.zip .
echo "Packaging Done!"
cd ..

# Upload to bucket
echo "Uploading to bucket..."
aws s3 cp $CURRENT_DIR/staging/requestLambda-$VERSION.zip s3://moving-average-tracker-bucket/lambda-source-code/
echo "Uploaded to bucket!"

# Deploy stack
echo "deploying setup.."
aws cloudformation deploy \
  --template-file $CURRENT_DIR/template/cloudformation.yaml \
  --stack-name $APP_NAME \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides $STACK_PARAMETERS

cd $CURRENT_DIR