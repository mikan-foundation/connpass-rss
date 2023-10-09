import { Stack, StackProps, Duration, aws_s3 as s3 } from "aws-cdk-lib";
import { AllowedMethods, CachePolicy, CachedMethods, Distribution, OriginAccessIdentity, PriceClass, ViewerProtocolPolicy } from "aws-cdk-lib/aws-cloudfront";
import { S3Origin } from "aws-cdk-lib/aws-cloudfront-origins";
import { Rule, Schedule } from "aws-cdk-lib/aws-events";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";
import {
  CanonicalUserPrincipal,
  Effect,
  ManagedPolicy,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import { AssetCode, Function, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";
import { join } from "path";
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class ConnpassRssStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const iamRoleForLambda = new Role(this, "iamRoleForLambda", {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMReadOnlyAccess'),
      ],
    });
    
    const bucket = new s3.Bucket(this, "ConnpassRssBucket");

    const oai = new OriginAccessIdentity(
      this,
      'OriginAccessIdentity',
    );


    bucket.addToResourcePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["s3:GetObject", "s3:PutObject"],
        principals: [iamRoleForLambda],
        resources: [bucket.bucketArn + "/*"],
      })
    );

    bucket.addToResourcePolicy(
      new PolicyStatement({
        actions:["s3:GetObject"],
        effect: Effect.ALLOW,
        principals: [
          new CanonicalUserPrincipal(
            oai.cloudFrontOriginAccessIdentityS3CanonicalUserId
          )
        ],
        resources: [bucket.bucketArn + "/*"],
      })
    )

    new Distribution(this, 'Distribution', {
      comment: 'RSS Feed',
      defaultRootObject: 'rss.xml',
      defaultBehavior: {
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
        cachedMethods: CachedMethods.CACHE_GET_HEAD,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        origin: new S3Origin(bucket),
      },
      errorResponses: [
        {
          ttl: Duration.seconds(300),
          httpStatus: 403,
          responseHttpStatus: 403,
          responsePagePath: '/error.html',
        },
        {
          ttl: Duration.seconds(300),
          httpStatus: 404,
          responseHttpStatus: 404,
          responsePagePath: '/error.html',
        },
      ],
      priceClass: PriceClass.PRICE_CLASS_ALL,
    });

    const xmlExportLambda = new NodejsFunction(this, "ConnpassReturnRss", {
      functionName: "ConnpassReturnRss",
      entry: join(__dirname, "../src/index.ts").toString(),
      runtime: Runtime.NODEJS_18_X,
      memorySize: 1024,
      timeout: Duration.seconds(300),
      role: iamRoleForLambda,
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ["@aws-sdk/*"],
        tsconfig: join(__dirname, "../tsconfig.json"),
        format: OutputFormat.CJS
      },
      environment: {
        S3_BUCKET_NAME: bucket.bucketName,
      },
    });

    new Rule(this, "Weekly Updates", {
      schedule: Schedule.cron({ minute: "0", hour: "15", weekDay: "MON", month: "*", year: "*" }),
      targets: [new LambdaFunction(xmlExportLambda, {retryAttempts: 2})],
    })
  }
}
