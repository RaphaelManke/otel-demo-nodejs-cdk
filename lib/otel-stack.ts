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
  Architecture,
  LayerVersion,
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

    /**
     * ADOT Lambda Instrumentation
     */
    const logGroupAdotLambda = new LogGroup(this, "adot-lambda-log-group", {
      logGroupName: "/aws/lambda/otel-demo-nodejs-cdk-adot",
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const adotLambda = new NodejsFunction(
      this,
      "otel-demo-nodejs-cdk-adot-lambda",
      {
        functionName: "otel-demo-nodejs-cdk-adot",
        logGroup: logGroupAdotLambda,
        memorySize: 1024,
        timeout: Duration.seconds(10),
        runtime: Runtime.NODEJS_20_X,
        entry: resolve(__dirname, "lambdas/adot/adotHandler.ts"),
        tracing: Tracing.ACTIVE,

        environment: {
          TABLE_NAME: table.tableName,
          // BEGIN: OpenTelemetry environment variables
          OTEL_SERVICE_NAME: "otel-demo-nodejs-cdk-adot",
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
                `cp ${resolve(
                  __dirname,
                  "lambdas/adot/collector.yaml"
                )} ${outputDir}`,
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
      }
    );

    /**
     * Otel collector layer
     * https://opentelemetry.io/docs/faas/lambda-collector/
     */

    const otelCollectorLayer = LayerVersion.fromLayerVersionArn(
      this,
      "otel-collector-layer",
      `arn:aws:lambda:${this.region}:184161586896:layer:opentelemetry-collector-arm64-0_4_0:1`
    );

    /**
     * Otel FAAS Instrumentation
     */
    const logGroupOtelLambda = new LogGroup(this, "otel-lambda-log-group", {
      logGroupName: "/aws/lambda/otel-demo-nodejs-cdk-otel",
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const otelLambda = new NodejsFunction(
      this,
      "otel-demo-nodejs-cdk-otel-lambda",
      {
        functionName: "otel-demo-nodejs-cdk-otel",
        logGroup: logGroupOtelLambda,
        memorySize: 1024,
        timeout: Duration.seconds(10),
        runtime: Runtime.NODEJS_20_X,
        entry: resolve(__dirname, "lambdas/otel/otelHandler.ts"),
        tracing: Tracing.ACTIVE,
        architecture: Architecture.ARM_64,

        environment: {
          TABLE_NAME: table.tableName,
          // BEGIN: OpenTelemetry environment variables
          OTEL_SERVICE_NAME: "otel-demo-nodejs-cdk-otel",
          OPENTELEMETRY_COLLECTOR_CONFIG_FILE: "/var/task/collector.yaml",
          HONEYCOMB_API_KEY: StringParameter.valueForStringParameter(
            this,
            "honeycomb-api-key"
          ),
          AWS_LAMBDA_EXEC_WRAPPER: "/opt/otel-handler",

          // END: OpenTelemetry environment variables
        },
        // BEGIN: OpenTelemetry layer instrumentation
        layers: [
          otelCollectorLayer,
          // https://opentelemetry.io/docs/faas/lambda-auto-instrument/
          LayerVersion.fromLayerVersionArn(
            this,
            "otel-nodejs-auto-instrumentation-layer",
            `arn:aws:lambda:${this.region}:184161586896:layer:opentelemetry-nodejs-0_4_0:1`
          ),
        ],
        // END: OpenTelemetry layer instrumentation
        bundling: {
          commandHooks: {
            // Copy the collector.yaml file to the output directory
            beforeBundling(inputDir: string, outputDir: string): string[] {
              return [
                `cp ${resolve(
                  __dirname,
                  "lambdas/otel/collector.yaml"
                )} ${outputDir}`,
              ];
            },
            afterBundling(): string[] {
              return [];
            },
            beforeInstall() {
              return [];
            },
          },
        },
      }
    );

    /**
     * Otel manual FAAS Instrumentation
     */
    const logGroupOtelManualLambda = new LogGroup(
      this,
      "otel-manual-lambda-log-group",
      {
        logGroupName: "/aws/lambda/otel-demo-nodejs-cdk-otel-manual",
        removalPolicy: RemovalPolicy.DESTROY,
      }
    );
    const otelManualLambda = new NodejsFunction(
      this,
      "otel-demo-nodejs-cdk-otel-manual-lambda",
      {
        functionName: "otel-demo-nodejs-cdk-otel-manual",
        logGroup: logGroupOtelManualLambda,
        memorySize: 1024,
        timeout: Duration.seconds(10),
        runtime: Runtime.NODEJS_20_X,
        entry: resolve(__dirname, "lambdas/otel-manual/otelHandler.ts"),
        tracing: Tracing.ACTIVE,
        architecture: Architecture.ARM_64,

        environment: {
          TABLE_NAME: table.tableName,
          // BEGIN: OpenTelemetry environment variables
          OTEL_SERVICE_NAME: "otel-demo-nodejs-cdk-otel-manual",
          OPENTELEMETRY_COLLECTOR_CONFIG_FILE: "/var/task/collector.yaml",
          HONEYCOMB_API_KEY: StringParameter.valueForStringParameter(
            this,
            "honeycomb-api-key"
          ),
          // AWS_LAMBDA_EXEC_WRAPPER: "/opt/otel-handler",
          NODE_OPTIONS: "--require instrumentation.js",

          // END: OpenTelemetry environment variables
        },
        // BEGIN: OpenTelemetry layer instrumentation
        layers: [otelCollectorLayer],
        // END: OpenTelemetry layer instrumentation
        bundling: {
          commandHooks: {
            // Copy the collector.yaml file to the output directory
            beforeBundling(inputDir: string, outputDir: string): string[] {
              return [
                `cp ${resolve(
                  __dirname,
                  "lambdas/otel-manual/collector.yaml"
                )} ${outputDir}`,
                `cp ${resolve(
                  __dirname,
                  "lambdas/otel-manual/instrumentation.js"
                )} ${outputDir}`,
                "npm install @opentelemetry/sdk-node @opentelemetry/api @opentelemetry/auto-instrumentations-node @opentelemetry/sdk-metrics @opentelemetry/sdk-trace-node",
              ];
            },
            afterBundling(): string[] {
              return [];
            },
            beforeInstall() {
              return [];
            },
          },
          nodeModules: [
            // Do not deploy, runtime function will use these values from the layer
            //  we have these deps in our package.json so that we can add
            //  OTel types to code + use honeycomb for local invokes of the lambda function
            "@opentelemetry/sdk-node",
            "@opentelemetry/api",
            "@opentelemetry/auto-instrumentations-node",
            "@opentelemetry/sdk-metrics",
            "@opentelemetry/sdk-trace-node",
            "@opentelemetry/exporter-trace-otlp-grpc",
            "@opentelemetry/instrumentation-aws-lambda",
            "@opentelemetry/instrumentation-aws-sdk",
          ],
        },
      }
    );

    /**
     * Connect to table and API Gateway
     */
    // Grant the lambda permissions to read and write data to the table
    // ADOT Lambda
    table.grantReadWriteData(adotLambda);
    api.root
      .addResource("adot")
      .addMethod("PUT", new LambdaIntegration(adotLambda));

    // OTEL Lambda
    table.grantReadWriteData(otelLambda);
    api.root
      .addResource("otel")
      .addMethod("PUT", new LambdaIntegration(otelLambda));

    // OTEL manual Lambda
    table.grantReadWriteData(otelManualLambda);
    api.root
      .addResource("otel-manual")
      .addMethod("PUT", new LambdaIntegration(otelManualLambda));
  }
}
