import { Duration, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import {
  EndpointType,
  LambdaIntegration,
  RestApi,
} from "aws-cdk-lib/aws-apigateway";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import {
  AdotLambdaExecWrapper,
  AdotLambdaLayerJavaScriptSdkVersion,
  AdotLayerVersion,
  Runtime,
  Tracing,
} from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";
import { resolve } from "path";

export class OtelStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const table = new Table(this, "Table", {
      partitionKey: { name: "id", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const api = new RestApi(this, "api", {
      restApiName: "otel-demo-nodejs-cdk-api",
      deployOptions: {
        tracingEnabled: true,
      },
      endpointConfiguration: {
        types: [EndpointType.REGIONAL],
      },
    });

    const logGroup = new LogGroup(this, "getItemLambdaLogGroup", {
      logGroupName: "/aws/lambda/getItemLambda",
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const putItemLambda = new NodejsFunction(this, "putItemLambda", {
      functionName: "otel-demo-nodejs-cdk-putItemLambda",
      logGroup,
      memorySize: 1024,
      timeout: Duration.seconds(10),
      runtime: Runtime.NODEJS_20_X,
      entry: resolve(__dirname, "lambdas/putItemHandler.ts"),
      tracing: Tracing.ACTIVE,

      environment: {
        TABLE_NAME: table.tableName,
        // BEGIN: OpenTelemetry environment variables
        OTEL_SERVICE_NAME: "otel-demo-nodejs-cdk",
        OPENTELEMETRY_COLLECTOR_CONFIG_FILE: "/var/task/collector.yaml",
        HONEYCOMB_API_KEY: StringParameter.valueForStringParameter(
          this,
          "honeycomb-api-key"
        ),

        // END: OpenTelemetry environment variables
      },
      // BEGIN: OpenTelemetry layer instrumentation
      adotInstrumentation: {
        execWrapper: AdotLambdaExecWrapper.REGULAR_HANDLER,
        layerVersion: AdotLayerVersion.fromJavaScriptSdkLayerVersion(
          AdotLambdaLayerJavaScriptSdkVersion.LATEST
        ),
      },
      // END: OpenTelemetry layer instrumentation
      bundling: {
        commandHooks: {
          // Copy the collector.yaml file to the output directory
          beforeBundling(inputDir: string, outputDir: string): string[] {
            return [
              `cp ${resolve(__dirname, "lambdas/collector.yaml")} ${outputDir}`,
            ];
          },
          afterBundling(): string[] {
            return [];
          },
          beforeInstall() {
            return [];
          },
        },

        /**
         * This is commented out because it makes no difference. But this was the suggestion from
         * the blog article.
         * https://dalejsalter.com/post/8afd46ad-7da2-4b2a-9cb5-9e5ae4fe6cc2/cdk-lambda-otel-honeycomb
         *
         */

        // keepNames: true,
        // nodeModules: [
        //   // For Otel's auto-instrumentation to work the package must be in node modules
        //   // Packages that autoinstrumentation will work on https://www.npmjs.com/package/@opentelemetry/auto-instrumentations-node
        //   "@aws-sdk/client-dynamodb",
        // ],
        // externalModules: [
        //   // Do not deploy, runtime function will use these values from the layer
        //   //  we have these deps in our package.json so that we can add
        //   //  OTel types to code + use honeycomb for local invokes of the lambda function
        //   "@opentelemetry/api",
        //   "@opentelemetry/sdk-node",
        //   "@opentelemetry/auto-instrumentations-node",
        // ],
      },
    });

    // Grant the lambda permissions to read and write data to the table
    table.grantReadWriteData(putItemLambda);
    // Add the PUT method to the API Gateway
    api.root.addMethod("PUT", new LambdaIntegration(putItemLambda));
  }
}
