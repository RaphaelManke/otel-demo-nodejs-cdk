# Example repository for AWS CDK app with Honeycomb otel integration

## Setup

1. run `npm install` to install the required packages
2. Add a System manager parameter with the name `HoneycombApiKey` and the value of your Honeycomb API key by replacing `<HONEYCOMB_API_KEY>` with your API key. You can do this by running the following command in the terminal
   - `aws ssm put-parameter --name "honeycomb-api-key" --type "String" --value "<HONEYCOMB_API_KEY>"`
3. run `npm run cdk deploy` to deploy the stack
