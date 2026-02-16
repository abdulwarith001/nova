export type ParsedTime = {
  timestamp?: number;
  error?: string;
};

export type ParsedSchedule = {
  scheduleText: string;
  intervalMs?: number;
  dailyTime?: { hour: number; minute: number };
  weekdaysOnly?: boolean;
  weekendsOnly?: boolean;
  cron?: string;
  needsTime?: boolean;
  error?: string;
};

const parseClockTime = (text: string): { hour: number; minute: number } | null => {
  const timeMatch = text.match(/(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (!timeMatch) return null;
  let hour = parseInt(timeMatch[1], 10);
  const minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
  const meridiem = timeMatch[3];

  if (meridiem === "pm" && hour !== 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;

  return { hour, minute };
};

export function parseTime(text: string): ParsedTime {
  const lower = text.toLowerCase().trim();

  // Relative time: in/next X units
  const relativeMatch = lower.match(
    /(?:in|next)\s+(\d+)\s+(second|seconds|sec|secs|minute|minutes|min|hour|hours|hr|hrs|day|days|week|weeks)\b/,
  );
  if (relativeMatch) {
    const amount = parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2];
    const now = Date.now();
    let ms = 0;
    switch (unit) {
      case "second":
      case "seconds":
      case "sec":
      case "secs":
        ms = amount * 1000;
        break;
      case "minute":
      case "minutes":
      case "min":
        ms = amount * 60 * 1000;
        break;
      case "hour":
      case "hours":
      case "hr":
      case "hrs":
        ms = amount * 60 * 60 * 1000;
        break;
      case "day":
      case "days":
        ms = amount * 24 * 60 * 60 * 1000;
        break;
      case "week":
      case "weeks":
        ms = amount * 7 * 24 * 60 * 60 * 1000;
        break;
    }
    return { timestamp: now + ms };
  }

  // Absolute time (today/tomorrow) or clock time
  const timeMatch = lower.match(
    /(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/,
  );
  if (timeMatch) {
    let hour = parseInt(timeMatch[1], 10);
    const minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    const meridiem = timeMatch[3];

    if (meridiem === "pm" && hour !== 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;

    const now = new Date();
    const target = new Date();
    target.setHours(hour, minute, 0, 0);

    if (lower.includes("tomorrow")) {
      target.setDate(target.getDate() + 1);
    } else if (target <= now) {
      target.setDate(target.getDate() + 1);
    }

    return { timestamp: target.getTime() };
  }

  return { error: "Could not parse time" };
}

export function parseSchedule(text: string): ParsedSchedule {
  const lower = text.toLowerCase().trim();

  // Cron fallback (5 or 6 fields)
  const cronMatch = lower.match(
    /^([\d*/,-]+\s+){4,5}[\d*/,-]+$/,
  );
  if (cronMatch) {
    return { scheduleText: text.trim(), cron: text.trim() };
  }

  // Interval: every N units
  const intervalMatch = lower.match(
    /every\s+(\d+)\s+(second|seconds|sec|secs|minute|minutes|min|hour|hours|hr|hrs|day|days|week|weeks)\b/,
  );
  if (intervalMatch) {
    const amount = parseInt(intervalMatch[1], 10);
    const unit = intervalMatch[2];
    let ms = 0;
    switch (unit) {
      case "second":
      case "seconds":
      case "sec":
      case "secs":
        ms = amount * 1000;
        break;
      case "minute":
      case "minutes":
      case "min":
        ms = amount * 60 * 1000;
        break;
      case "hour":
      case "hours":
      case "hr":
      case "hrs":
        ms = amount * 60 * 60 * 1000;
        break;
      case "day":
      case "days":
        ms = amount * 24 * 60 * 60 * 1000;
        break;
      case "week":
      case "weeks":
        ms = amount * 7 * 24 * 60 * 60 * 1000;
        break;
    }
    return { scheduleText: text.trim(), intervalMs: ms };
  }

  // Daily / weekday / weekend with optional time
  const isWeekday = /weekdays?/.test(lower);
  const isWeekend = /weekends?/.test(lower);
  const isDaily = /daily|every day/.test(lower);
  const isMorningish = /every\s+(morning|afternoon|evening|night)/.test(lower);

  if (isWeekday || isWeekend || isDaily || isMorningish) {
    const clock = parseClockTime(lower);
    if (!clock) {
      return {
        scheduleText: text.trim(),
        needsTime: true,
        weekdaysOnly: isWeekday || false,
        weekendsOnly: isWeekend || false,
      };
    }
    return {
      scheduleText: text.trim(),
      dailyTime: clock,
      weekdaysOnly: isWeekday || false,
      weekendsOnly: isWeekend || false,
    };
  }

  return { scheduleText: text.trim(), error: "Could not parse schedule" };
}
