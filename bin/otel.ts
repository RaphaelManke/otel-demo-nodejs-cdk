#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { OtelStack } from "../lib/otel-stack";

const app = new cdk.App();
new OtelStack(app, "OtelStack", {});
