const TYPE_WEIGHT = Object.freeze({
  event: 1,
  result: 2,
  placement: 3
});

function timestampOf(notification) {
  const value = Date.parse(notification.timestamp);
  return Number.isFinite(value) ? value : 0;
}

/** Negative means a is less important; positive means a is more important. */
function compareImportance(a, b) {
  const weightDifference = (TYPE_WEIGHT[a.type.toLowerCase()] || 0)
    - (TYPE_WEIGHT[b.type.toLowerCase()] || 0);
  if (weightDifference !== 0) return weightDifference;

  const timeDifference = timestampOf(a) - timestampOf(b);
  if (timeDifference !== 0) return timeDifference;
  return a.id.localeCompare(b.id);
}

class TopKNotifications {
  constructor(capacity = 20) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError("capacity must be a positive integer");
    }
    this.capacity = capacity;
    this.heap = [];
    this.seenIds = new Set();
  }

  add(notification) {
    if (!notification?.id || this.seenIds.has(notification.id)) return false;
    this.seenIds.add(notification.id);

    if (this.heap.length < this.capacity) {
      this.heap.push(notification);
      this.#bubbleUp(this.heap.length - 1);
      return true;
    }

    if (compareImportance(notification, this.heap[0]) <= 0) return false;
    this.heap[0] = notification;
    this.#bubbleDown(0);
    return true;
  }

  addMany(notifications) {
    let changed = 0;
    for (const notification of notifications) {
      if (this.add(notification)) changed += 1;
    }
    return changed;
  }

  top(limit = 10) {
    const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), this.capacity);
    return [...this.heap].sort((a, b) => compareImportance(b, a)).slice(0, safeLimit);
  }

  #bubbleUp(index) {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (compareImportance(this.heap[index], this.heap[parent]) >= 0) break;
      [this.heap[index], this.heap[parent]] = [this.heap[parent], this.heap[index]];
      index = parent;
    }
  }

  #bubbleDown(index) {
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let least = index;
      if (left < this.heap.length && compareImportance(this.heap[left], this.heap[least]) < 0) least = left;
      if (right < this.heap.length && compareImportance(this.heap[right], this.heap[least]) < 0) least = right;
      if (least === index) return;
      [this.heap[index], this.heap[least]] = [this.heap[least], this.heap[index]];
      index = least;
    }
  }
}

module.exports = { TYPE_WEIGHT, compareImportance, TopKNotifications };
