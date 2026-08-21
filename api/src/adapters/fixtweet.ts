import type {
  DataSourceAdapter,
  NormalizedTweet,
  NormalizedUser,
  NormalizedMedia,
  TimelineResult,
} from "../lib/types.js";

const FIXTWEET_BASE = "https://api.fxtwitter.com/2";
const TIMEOUT = parseInt(process.env.FIXTWEET_TIMEOUT ?? "10000", 10);

async function fetchWithTimeout(
  url: string,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Pravaha/1.0",
        Accept: "application/json",
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

function parseMedia(
  mediaList: Array<Record<string, unknown>> | undefined
): NormalizedMedia[] {
  if (!mediaList?.length) return [];

  return mediaList.map((m) => ({
    type:
      m.type === "photo"
        ? "image"
        : m.type === "gif"
          ? "gif"
          : "video",
    url: String(m.url ?? ""),
    thumbnailUrl: m.thumbnail_url as string | undefined,
    altText: m.altText as string | undefined,
    width: m.width as number | undefined,
    height: m.height as number | undefined,
    durationMs: m.duration as number | undefined,
  }));
}

function parseTweet(raw: Record<string, unknown>): NormalizedTweet {
  const author = raw.author as Record<string, unknown> | undefined;

  const mediaObj = raw.media as Record<string, unknown> | undefined;

  const mediaAll =
    mediaObj?.all as Array<Record<string, unknown>> | undefined;

  const photos =
    mediaObj?.photos as Array<Record<string, unknown>> | undefined;

  const videos =
    mediaObj?.videos as Array<Record<string, unknown>> | undefined;

  const mediaList =
    mediaAll ?? [...(photos ?? []), ...(videos ?? [])];

  const quote = raw.quote as Record<string, unknown> | undefined;

  return {
    id: String(raw.id ?? ""),
    authorId: String(author?.id ?? ""),
    authorHandle: String(
      author?.screen_name ?? raw.author_screen_name ?? ""
    ),
    authorName: String(
      author?.name ?? raw.author_name ?? ""
    ),
    authorAvatarUrl:
      (author?.avatar_url as string) ?? null,

    text: String(raw.text ?? ""),
    html: null,

    createdAt: new Date(
      String(
        raw.created_at ??
        raw.created_timestamp ??
        Date.now()
      )
    ),

    media: parseMedia(mediaList),

    likes: Number(raw.likes ?? 0),
    retweets: Number(raw.reposts ?? raw.retweets ?? 0),
    replies: Number(raw.replies ?? 0),
    views: Number(raw.views ?? 0),

    quotedTweetId:
      quote?.id != null
        ? String(quote.id)
        : null,

    replyToId:
      raw.replying_to != null
        ? String(raw.replying_to)
        : null,

    isRetweet: false,
    retweetedBy: null,
  };
}

function parseUser(raw: Record<string, unknown>): NormalizedUser {
  const verification =
    raw.verification as Record<string, unknown> | undefined;

  return {
    id: String(raw.id ?? ""),
    handle: String(raw.screen_name ?? ""),
    name: String(raw.name ?? ""),
    bio: (raw.description as string) ?? null,
    avatarUrl: (raw.avatar_url as string) ?? null,
    bannerUrl: (raw.banner_url as string) ?? null,

    followersCount: Number(raw.followers ?? 0),
    followingCount: Number(raw.following ?? 0),

    tweetCount: Number(
      raw.statuses ??
      raw.tweets ??
      raw.statuses_count ??
      0
    ),

    joinDate: (raw.joined as string) ?? null,

    verified:
      Boolean(raw.verified) ||
      verification?.type === "individual" ||
      verification?.type === "organization",
  };
}

async function fetchUserRaw(
  handle: string
): Promise<Record<string, unknown>> {
  const cleanHandle = handle.replace(/^@/, "").trim();

  const res = await fetchWithTimeout(
    `${FIXTWEET_BASE}/profile/${encodeURIComponent(cleanHandle)}`,
    TIMEOUT
  );

  if (!res.ok) {
    throw new Error(
      `FixTweet user fetch failed: ${res.status} ${res.statusText}`
    );
  }

  const data =
    (await res.json()) as Record<string, unknown>;

  const userRaw =
    data.user as Record<string, unknown> | undefined;

  if (!userRaw) {
    throw new Error("FixTweet returned no user data");
  }

  return userRaw;
}

export const fixtweet: DataSourceAdapter = {
  name: "fixtweet",

  async fetchTimeline(
    handle: string,
    cursor?: string
  ): Promise<TimelineResult> {
    const cleanHandle = handle.replace(/^@/, "").trim();

    // Fetch current profile
    const userRaw = await fetchUserRaw(cleanHandle);
    const user = parseUser(userRaw);

    // Fetch current timeline
    const url = new URL(
      `${FIXTWEET_BASE}/profile/${encodeURIComponent(cleanHandle)}/statuses`
    );

    if (cursor) {
      url.searchParams.set("cursor", cursor);
    }

    const res = await fetchWithTimeout(
      url.toString(),
      TIMEOUT
    );

    if (!res.ok) {
      throw new Error(
        `FixTweet timeline fetch failed: ${res.status} ${res.statusText}`
      );
    }

    const data =
      (await res.json()) as Record<string, unknown>;

    const results =
      (data.results as Array<Record<string, unknown>> | undefined) ??
      [];

    const tweets = results.map(parseTweet);

    const nextCursor =
      typeof data.next_cursor === "string"
        ? data.next_cursor
        : typeof data.cursor === "string"
          ? data.cursor
          : undefined;

    return {
      user,
      tweets,
      ...(nextCursor ? { cursor: nextCursor } : {}),
    };
  },

  async fetchTweet(
    id: string
  ): Promise<{
    tweet: NormalizedTweet;
    thread?: NormalizedTweet[];
  }> {
    const res = await fetchWithTimeout(
      `${FIXTWEET_BASE}/status/${encodeURIComponent(id)}`,
      TIMEOUT
    );

    if (!res.ok) {
      throw new Error(
        `FixTweet tweet fetch failed: ${res.status} ${res.statusText}`
      );
    }

    const data =
      (await res.json()) as Record<string, unknown>;

    const tweetRaw =
      data.tweet as Record<string, unknown> | undefined;

    if (!tweetRaw) {
      throw new Error(
        "FixTweet returned no tweet data"
      );
    }

    return {
      tweet: parseTweet(tweetRaw),
    };
  },

  async fetchUser(
    handle: string
  ): Promise<NormalizedUser> {
    return parseUser(await fetchUserRaw(handle));
  },

  // FxTwitter search support can be added separately.
};
