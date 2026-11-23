import { api, DateRange, NewsSummaryResponse } from "../api";
import AiSummaryCard from "./AiSummaryCard";
import SummaryView from "./SummaryView";

interface Props {
  ticker: string;
  range: DateRange | null;
  isAdmin: boolean;
}

/** AI summary of the headlines below it. */
export default function NewsSummary({ ticker, range, isAdmin }: Props) {
  return (
    <AiSummaryCard<NewsSummaryResponse>
      title="AI summary"
      resetKey={`${ticker}|${range ? `${range.start}:${range.end}` : ""}`}
      isAdmin={isAdmin}
      peek={() => api.peekNewsSummary(ticker, range)}
      generate={(refresh) => api.newsSummary(ticker, range, refresh)}
      save={(whenDone) => api.saveNewsSummary(ticker, range, whenDone)}
      cancelSave={() => api.cancelNewsSaveWhenDone(ticker, range)}
      intro="Get Claude's read on these headlines: sentiment, a buy/hold/sell view, the top happenings, risks and more."
      buttonLabel="Summarize with Claude"
      workingText="Claude is reading the articles… usually a minute or two"
      noneText="No AI summary for these headlines yet."
      render={(entry, footer) => <SummaryView entry={entry} footer={footer} />}
    />
  );
}
