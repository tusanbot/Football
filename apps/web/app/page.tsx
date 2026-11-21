import MarketPage from "./market-client";

export default function HomePage() {
  return <>
    <div className="match-center-entry"><a href="/matches">مرکز مسابقات و تصمیمات زنده</a> · <a href="/store">فروشگاه باشگاه</a> · <a href="/legends-draft">درفت اسطوره‌ها</a></div>
    <MarketPage />
  </>;
}
