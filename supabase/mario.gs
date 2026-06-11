function parseMarioKartTime(value) {
  if (value === null || value === undefined || value === "") return null;

  // If Sheets passes a numeric duration, treat fractions of a day as Sheets time.
  if (typeof value === "number") {
    if (!isFinite(value)) throw new Error("Invalid numeric time: " + value);
    return value > 0 && value < 1 ? value * 24 * 60 * 60 : value;
  }

  // If Sheets passes a Date/time object.
  if (Object.prototype.toString.call(value) === "[object Date]") {
    return (
      value.getHours() * 3600 +
      value.getMinutes() * 60 +
      value.getSeconds() +
      value.getMilliseconds() / 1000
    );
  }

  var text = String(value).trim();
  var match = text.match(/^(\d+):([0-5]?\d)(?:\.(\d{1,3}))?$/);

  if (!match) {
    throw new Error('Invalid MKWii time "' + value + '". Use m:ss.xxx, like 1:23.456.');
  }

  var minutes = Number(match[1]);
  var seconds = Number(match[2]);
  var milliseconds = Number((match[3] || "0").padEnd(3, "0"));

  return minutes * 60 + seconds + milliseconds / 1000;
}

function getTimeList(input) {
  var times = [];

  function walk(value) {
    if (Array.isArray(value)) {
      for (var i = 0; i < value.length; i++) walk(value[i]);
      return;
    }

    var parsed = parseMarioKartTime(value);
    if (parsed !== null) times.push(parsed);
  }

  walk(input);

  if (times.length === 0) {
    throw new Error("No MKWii times found.");
  }

  return times;
}

function formatMarioKartTime(totalSeconds) {
  var totalMilliseconds = Math.round(totalSeconds * 1000);

  var minutes = Math.floor(totalMilliseconds / 60000);
  var seconds = Math.floor((totalMilliseconds % 60000) / 1000);
  var milliseconds = totalMilliseconds % 1000;

  return (
    minutes +
    ":" +
    String(seconds).padStart(2, "0") +
    "." +
    String(milliseconds).padStart(3, "0")
  );
}

function average(values) {
  var total = 0;
  for (var i = 0; i < values.length; i++) total += values[i];
  return total / values.length;
}

function median(values) {
  var sorted = values.slice().sort(function (a, b) {
    return a - b;
  });

  var middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) return sorted[middle];

  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function standardDeviation(values) {
  var avg = average(values);
  var totalSquaredDifference = 0;

  for (var i = 0; i < values.length; i++) {
    totalSquaredDifference += Math.pow(values[i] - avg, 2);
  }

  return Math.sqrt(totalSquaredDifference / values.length);
}

// New clean names

function MK_SECONDS(time) {
  return parseMarioKartTime(time);
}

function MK_TIME(seconds) {
  return formatMarioKartTime(seconds);
}

function MK_AVG(times) {
  return formatMarioKartTime(average(getTimeList(times)));
}

function MK_MEDIAN(times) {
  return formatMarioKartTime(median(getTimeList(times)));
}

function MK_RANGE(times) {
  var values = getTimeList(times);
  return Math.max.apply(null, values) - Math.min.apply(null, values);
}

function MK_RANGE_TIME(times) {
  return formatMarioKartTime(MK_RANGE(times));
}

function MK_STDEV(times) {
  return standardDeviation(getTimeList(times));
}

function MK_STDEV_TIME(times) {
  return formatMarioKartTime(MK_STDEV(times));
}

function MK_SORT(times) {
  return getTimeList(times)
    .sort(function (a, b) {
      return a - b;
    })
    .map(function (seconds) {
      return [formatMarioKartTime(seconds)];
    });
}

function MK_STATS(times) {
  var values = getTimeList(times);
  var best = Math.min.apply(null, values);
  var worst = Math.max.apply(null, values);
  var avg = average(values);
  var med = median(values);
  var range = worst - best;
  var stdev = standardDeviation(values);

  return [
    ["Metric", "Time", "Seconds"],
    ["Runs", values.length, ""],
    ["Best", formatMarioKartTime(best), best],
    ["Worst", formatMarioKartTime(worst), worst],
    ["Average", formatMarioKartTime(avg), avg],
    ["Median", formatMarioKartTime(med), med],
    ["Range", formatMarioKartTime(range), range],
    ["Std Dev", formatMarioKartTime(stdev), stdev]
  ];
}

// Backward-compatible names from the original version

function RETURN_SECONDS(time) {
  return MK_SECONDS(time);
}

function RETURN_TIME(seconds) {
  return MK_TIME(seconds);
}

function RAT(times) {
  return MK_AVG(times);
}

function RSA(times) {
  return MK_AVG(times);
}

function RM(times) {
  return MK_MEDIAN(times);
}

function RR(times) {
  return MK_RANGE(times);
}