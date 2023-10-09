import { S3, SSM } from "aws-sdk";
import { XMLBuilder } from "fast-xml-parser";
import {load} from "cheerio";

const putXmlRSS = async (xml: any) => {
  const s3 = new S3();
  const params = {
    Bucket: process.env.S3_BUCKET_NAME!,
    Key: "rss.xml",
    Body: xml,
    ContentType: "application/xml",
  };
  await s3.putObject(params).promise();
};

const ssm = new SSM();

type ConnpassResponse = {
  results_returned: number;
  results_available: number;
  results_start: number;
  events: ConnpassEvent[];
}

type ConnpassEvent = {
  event_id: string;
  title: string;
  catch: string;
  description: string;
  event_url: string;
  hash_tag: string;
  started_at: string;
  ended_at: string;
  limit: number;
}

export const handler = async function () {
  const groupIdsParameter = await ssm
    .getParameter({ Name: "/Lambda/Rss/GroupIds"})
    .promise();

  const groupIdsArray = groupIdsParameter.Parameter?.Value?.split(",");
  console.log("Connpass Group Ids from SSM:", groupIdsArray)

  console.log("Conpass API Request URL", `https://connpass.com/api/v1/event/?series_id=${groupIdsArray?.join(
    ","
  )}&count=10&order=2`)

  const res: ConnpassResponse = await fetch(
    `https://connpass.com/api/v1/event/?series_id=${groupIdsArray?.join(
      ","
    )}&count=10&order=2`
  ).then((res) => res.json()).catch((err) => console.error(err))

  console.log("Connpass API Response", res)

  const xmlItems = await Promise.all(res.events.map(async (event) => {

    const html = await fetch(event.event_url).then((res) => res.text())
    const dom = load(html)
    const thumbnailUrl = dom('meta[property="og:image"]').attr('content');

    return {
      title: event.title,
      link: event.event_url,
      description: event.description,
      started_at: event.started_at,
      ended_at: event.ended_at,
      cover: thumbnailUrl,
    };
  }))

  console.log("XML Events: ", xmlItems)

  const builder = new XMLBuilder({
    arrayNodeName: "item",
    format: true,
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
  });
  const xml = builder.build({
    "?xml": {
      "@_version": "1.0",
      "@_encoding": "UTF-8",
    },
    rss: {
      "@_version": "2.0",
      channel: {
        title: "札幌開催イベント RSS Feed | Sapporo Engineer Base",
        link: "https://rss.sapporo-engineer-base.dev/",
        description:
          "札幌で開催されるイベントのRSSフィードです。新着10件を表示しています。",
        item: xmlItems
      },
    },
  });

  await putXmlRSS(xml);

  return {
    statusCode: 200,
    body: "",
  };
};
