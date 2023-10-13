export type ConnpassResponse  = {
  results_returned: number;
  results_available: number;
  results_start: number;
  events: ConnpassEvent[];
}

export type ConnpassEvent = {
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


const baseUrl = "https://conpass.com/api/v1/event/?";

const ConnpassGetEvents = async (max: number = 10, order: number = 2, groupIds: string[] | undefined, eventIds: string[] | undefined, keywords: string[] | undefined): Promise<ConnpassEvent[]> =>  {
  const params = new URLSearchParams();
  params.append("count", max.toString());
  params.append("order", order.toString());
  if(keywords) params.append("keyword", keywords.join(","));
  if(groupIds) params.append("series_id", groupIds.join(","));
  if(eventIds) params.append("event_id", eventIds.join(","));

  const res= await fetch(baseUrl + params.toString());
  const json: ConnpassResponse  = await res.json();
  return json.events;
} 

export {ConnpassGetEvents}