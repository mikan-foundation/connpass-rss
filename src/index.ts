import { S3, SSM } from "aws-sdk";
import { XMLBuilder } from "fast-xml-parser";
import { load } from "cheerio";

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
};

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
};

export const handler = async function () {
  const groupIdsParameter = await ssm
    .getParameter({ Name: "/Lambda/Rss/GroupIds" })
    .promise();

  const eventIdsParameter = await ssm
    .getParameter({ Name: "/Lambda/Rss/EventIds" })
    .promise();

  const groupIdsArray = groupIdsParameter.Parameter?.Value?.split(",");
  const eventIdsArray =  eventIdsParameter.Parameter?.Value?.split(",");

  console.log("Connpass Group Ids from SSM:", groupIdsArray);
  console.log("Connpass Event Ids from SSM:", eventIdsArray);

  console.log(
    "Connpass API Request URL",
    `https://connpass.com/api/v1/event/?series_id=${groupIdsArray?.join(
      ","
    )}&count=10&order=2`
  );

  const res: ConnpassResponse = await fetch(
    `https://connpass.com/api/v1/event/?series_id=${groupIdsArray?.join(
      ","
    )}&count=10&order=2`
  )
    .then((res) => res.json())
    .catch((err) => console.error(err));

  console.log("Connpass API Response", res);

  const grpEventItems = await Promise.all(
    res.events.map(async (event) => {
      const html = await fetch(event.event_url).then((res) => res.text());
      const dom = load(html);
      const thumbnailUrl = dom('meta[property="og:image"]').attr("content");

      return {
        title: event.title,
        link: event.event_url,
        description: event.description,
        started_at: event.started_at,
        ended_at: event.ended_at,
        cover: thumbnailUrl,
      };
    })
  );

  const eventItems = await Promise.all(
    eventIdsArray?.map(async (eventId) => {
      const html = await fetch(`https://connpass.com/event/${eventId}/`).then(
        (res) => res.text()
      );
      const dom = load(html);
      const thumbnailUrl = dom('meta[property="og:image"]').attr("content");

      const res = await fetch(`https://connpass.com/api/v1/event/?event_id=${eventId}`)
      .then((res) => res.json())
      .catch((err) => console.error(err));

      return {
        title: dom("title").text(),
        link: `https://connpass.com/event/${eventId}/`,
        description: dom('meta[property="og:description"]').attr("content"),
        started_at: res.events[0].started_at,
        ended_at: res.events[0].ended_at,
        cover: thumbnailUrl,
      };
    }) ?? []
  );

  const items = [...grpEventItems, ...eventItems];
  // 重複を削除し、開催日時の降順にソート
  const xmlItems = items.filter((item) => {
    return (
      items.findIndex((i) => i.link === item.link) ===
      items.findIndex((i) => i.started_at === item.started_at)
    );
  }).sort((a, b) => {  
    if (a.started_at > b.started_at) {
      return -1;
    } else {
      return 1;
    }
  })

  console.log("XML Events: ", xmlItems);

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
        item: xmlItems,
      },
    },
  });

  await putXmlRSS(xml);

  return {
    statusCode: 200,
    body: "",
  };
};
