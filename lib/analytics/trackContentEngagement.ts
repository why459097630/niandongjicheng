export type ContentEngagementAction =
  | "dish_view"
  | "dish_click"
  | "announcement_view";

type TrackContentEngagementInput = {
  storeId: string;
  action: ContentEngagementAction;
  dishId?: string | null;
  announcementId?: string | null;
};

export async function trackContentEngagement(
  input: TrackContentEngagementInput,
): Promise<void> {
  const response = await fetch("/api/track-content-engagement", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      storeId: input.storeId,
      action: input.action,
      dishId: input.dishId ?? null,
      announcementId: input.announcementId ?? null,
    }),
    keepalive: true,
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;

    throw new Error(data?.error || "trackContentEngagement failed");
  }
}