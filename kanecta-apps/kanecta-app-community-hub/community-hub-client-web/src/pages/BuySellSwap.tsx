import PageLayout from "../components/PageLayout";
import SiteEditablePage from "../components/SiteEditablePage";

export default function BuySellSwap() {
  return (
    <PageLayout pageName="Buy, Sell & Swap" showComingSoon={false} showHeading={false}>
      <SiteEditablePage slug="buy-sell-swap" title="Buy, Sell & Swap">
        <p>Buy, sell, swap, or give away items locally.</p>
      </SiteEditablePage>
    </PageLayout>
  );
}
