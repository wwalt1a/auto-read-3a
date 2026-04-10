// ==UserScript==
// @name         Auto Read
// @namespace    http://tampermonkey.net/
// @version      1.4.6
// @description  自动刷linuxdo文章
// @author       liuweiqing
// @match        https://meta.discourse.org/*
// @match        https://linux.do/*
// @match        https://meta.appinn.net/*
// @match        https://community.openai.com/
// @match        https://3a.lol/*
// @match        https://idcflare.com/*
// @exclude      https://linux.do/a/9611/0
// @grant        none
// @license      MIT
// @icon         https://www.google.com/s2/favicons?domain=linux.do
// @downloadURL https://update.greasyfork.org/scripts/489464/Auto%20Read.user.js
// @updateURL https://update.greasyfork.org/scripts/489464/Auto%20Read.meta.js
// ==/UserScript==

(function () {
  ("use strict");
  // 定义可能的基本URL
  const possibleBaseURLs = [
    "https://linux.do",
    "https://meta.discourse.org",
    "https://meta.appinn.net",
    "https://community.openai.com",
    "https://3a.lol",
    "https://idcflare.com/",
  ];
  const commentLimit = 1000;
  const topicListLimit = 30;
  const likeLimit = 50;
  const delay = 3000;
  const minTopicDwellMs = 15000;
  const maxTopicDwellMs = 30000;
  const nextTopicJitterMs = 2500;
  const cooldownCheckIntervalMs = 5000;
  const minScrollStep = 8;
  const maxScrollStep = 16;
  const minScrollDelayMs = 110;
  const maxScrollDelayMs = 180;
  // 获取当前页面的URL
  const currentURL = window.location.href;

  // 确定当前页面对应的BASE_URL
  let BASE_URL = possibleBaseURLs.find((url) => currentURL.startsWith(url));
  console.log("currentURL:", currentURL);
  // 环境变量：阅读网址，如果没有找到匹配的URL，则默认为第一个
  if (!BASE_URL) {
    BASE_URL = possibleBaseURLs[0];
    console.log("默认BASE_URL设置为: " + BASE_URL);
  } else {
    console.log("当前BASE_URL是: " + BASE_URL);
  }

  console.log("脚本正在运行在: " + BASE_URL);
  //1.进入网页 https://linux.do/t/topic/数字（1，2，3，4）
  //2.使滚轮均衡的往下移动模拟刷文章
  // 检查是否是第一次运行脚本
  function checkFirstRun() {
    if (localStorage.getItem("isFirstRun") === null) {
      console.log("脚本第一次运行，执行初始化操作...");
      updateInitialData();
      localStorage.setItem("isFirstRun", "false");
    } else {
      console.log("脚本非第一次运行");
    }
  }

  // 更新初始数据的函数
  function updateInitialData() {
    localStorage.setItem("read", "false"); // 开始时自动滚动关闭
    localStorage.setItem("autoLikeEnabled", "false"); //默认关闭自动点赞
    console.log("执行了初始数据更新操作");
  }
  let scrollInterval = null;
  let checkScrollTimeout = null;
  let autoLikeInterval = null;
  let pendingTopicOpenTimeout = null;
  let pendingTopicOpenAt = 0;
  let lastCooldownLogAt = 0;

  function stopScrolling() {
    if (scrollInterval !== null) {
      clearInterval(scrollInterval);
      scrollInterval = null;
    }
  }

  function clearPendingTopicOpen() {
    if (pendingTopicOpenTimeout !== null) {
      clearTimeout(pendingTopicOpenTimeout);
      pendingTopicOpenTimeout = null;
      pendingTopicOpenAt = 0;
    }
  }

  function scheduleCheckScroll(waitMs = delay) {
    if (checkScrollTimeout !== null) {
      clearTimeout(checkScrollTimeout);
    }
    checkScrollTimeout = setTimeout(checkScroll, waitMs);
  }

  function isTopicPage() {
    return window.location.pathname.includes("/t/topic/");
  }

  function getCurrentPageKey() {
    return `${window.location.pathname}${window.location.search}`;
  }

  function calculateTopicDwellMs() {
    const bodyHeight = document.body.scrollHeight || 0;
    const viewportHeight = window.innerHeight || 0;
    const baseMs = 12000 + Math.floor(Math.random() * 6000);
    const heightFactorMs = Math.min(
      9000,
      Math.max(0, bodyHeight - viewportHeight) * 2
    );
    return Math.max(
      minTopicDwellMs,
      Math.min(maxTopicDwellMs, baseMs + heightFactorMs)
    );
  }

  function ensureTopicReadState() {
    if (!isTopicPage()) {
      return;
    }

    const pageKey = getCurrentPageKey();
    const storedPageKey = localStorage.getItem("autoReadPageKey");
    if (storedPageKey !== pageKey) {
      const dwellMs = calculateTopicDwellMs();
      localStorage.setItem("autoReadPageKey", pageKey);
      localStorage.setItem("autoReadPageStartedAt", Date.now().toString());
      localStorage.setItem("autoReadPageDwellMs", dwellMs.toString());
      console.log(
        `[auto-read] 进入新主题 ${pageKey}，计划停留 ${Math.ceil(
          dwellMs / 1000
        )} 秒`
      );
    }
  }

  function getRemainingDwellMs() {
    if (!isTopicPage()) {
      return 0;
    }

    ensureTopicReadState();
    const startedAt = parseInt(
      localStorage.getItem("autoReadPageStartedAt") || "0",
      10
    );
    const dwellMs = parseInt(
      localStorage.getItem("autoReadPageDwellMs") || "0",
      10
    );
    if (!startedAt || !dwellMs) {
      return 0;
    }
    return Math.max(0, startedAt + dwellMs - Date.now());
  }

  function getCooldownRemainingMs() {
    const cooldownUntil = parseInt(
      localStorage.getItem("autoReadCooldownUntil") || "0",
      10
    );
    if (!cooldownUntil) {
      return 0;
    }

    const remainingMs = cooldownUntil - Date.now();
    if (remainingMs <= 0) {
      localStorage.removeItem("autoReadCooldownUntil");
      return 0;
    }

    return remainingMs;
  }

  function getScrollSettings() {
    return {
      distancePerStep:
        minScrollStep +
        Math.floor(Math.random() * (maxScrollStep - minScrollStep + 1)),
      delayPerStep:
        minScrollDelayMs +
        Math.floor(
          Math.random() * (maxScrollDelayMs - minScrollDelayMs + 1)
        ),
    };
  }

  function scheduleOpenNextTopic(reason, waitMs) {
    const jitterMs = Math.floor(Math.random() * nextTopicJitterMs);
    const totalWaitMs = waitMs + jitterMs;
    const nextRunAt = Date.now() + totalWaitMs;

    if (
      pendingTopicOpenTimeout !== null &&
      pendingTopicOpenAt > 0 &&
      pendingTopicOpenAt <= nextRunAt + 500
    ) {
      return;
    }

    clearPendingTopicOpen();
    pendingTopicOpenAt = nextRunAt;
    console.log(
      `[auto-read] ${reason}，将在 ${Math.ceil(totalWaitMs / 1000)} 秒后打开下一篇`
    );
    pendingTopicOpenTimeout = setTimeout(() => {
      pendingTopicOpenTimeout = null;
      pendingTopicOpenAt = 0;
      checkScroll();
    }, totalWaitMs);
  }

  function scrollToBottomSlowly(distancePerStep = 20, delayPerStep = 50) {
    stopScrolling();
    scrollInterval = setInterval(() => {
      window.scrollBy(0, distancePerStep);
    }, delayPerStep); // 每50毫秒滚动20像素
  }

  function getLatestTopic() {
    let latestPage = Number(localStorage.getItem("latestPage")) || 0;
    let topicList = [];
    let isDataSufficient = false;

    while (!isDataSufficient) {
      latestPage++;
      const url = `${BASE_URL}/latest.json?no_definitions=true&page=${latestPage}`;

      $.ajax({
        url: url,
        async: false,
        success: function (result) {
          if (
            result &&
            result.topic_list &&
            result.topic_list.topics.length > 0
          ) {
            result.topic_list.topics.forEach((topic) => {
              // 未读且评论数小于 commentLimit
              if (commentLimit > topic.posts_count) {
                //其实不需要 !topic.unseen &&
                topicList.push(topic);
              }
            });

            // 检查是否已获得足够的 topics
            if (topicList.length >= topicListLimit) {
              isDataSufficient = true;
            }
          } else {
            isDataSufficient = true; // 没有更多内容时停止请求
          }
        },
        error: function (XMLHttpRequest, textStatus, errorThrown) {
          console.error(XMLHttpRequest, textStatus, errorThrown);
          isDataSufficient = true; // 遇到错误时也停止请求
        },
      });
    }

    if (topicList.length > topicListLimit) {
      topicList = topicList.slice(0, topicListLimit);
    }

    // 其实不需要对latestPage操作
    // localStorage.setItem("latestPage", latestPage);
    localStorage.setItem("topicList", JSON.stringify(topicList));
  }

  function openNewTopic() {
    stopScrolling();
    clearPendingTopicOpen();

    let topicListStr = localStorage.getItem("topicList");
    let topicList = topicListStr ? JSON.parse(topicListStr) : [];

    // 如果列表为空，则获取最新文章
    if (topicList.length === 0) {
      getLatestTopic();
      topicListStr = localStorage.getItem("topicList");
      topicList = topicListStr ? JSON.parse(topicListStr) : [];
    }

    // 如果获取到新文章，打开第一个
    if (topicList.length > 0) {
      const topic = topicList.shift();
      localStorage.setItem("topicList", JSON.stringify(topicList));
      localStorage.removeItem("autoReadPageKey");
      localStorage.removeItem("autoReadPageStartedAt");
      localStorage.removeItem("autoReadPageDwellMs");
      if (topic.last_read_post_number) {
        window.location.href = `${BASE_URL}/t/topic/${topic.id}/${topic.last_read_post_number}`;
      } else {
        window.location.href = `${BASE_URL}/t/topic/${topic.id}`;
      }
    }
  }

  // 检查是否已滚动到底部(不断重复执行),到底部时跳转到下一个话题
  function checkScroll() {
    if (localStorage.getItem("read") !== "true") {
      stopScrolling();
      clearPendingTopicOpen();
      return;
    }

    const cooldownRemainingMs = getCooldownRemainingMs();
    if (cooldownRemainingMs > 0) {
      stopScrolling();
      if (Date.now() - lastCooldownLogAt > 10000) {
        console.log(
          `[auto-read] 429 冷却中，剩余 ${Math.ceil(
            cooldownRemainingMs / 1000
          )} 秒`
        );
        lastCooldownLogAt = Date.now();
      }
      scheduleCheckScroll(
        Math.min(cooldownRemainingMs + 500, cooldownCheckIntervalMs)
      );
      return;
    }

    ensureTopicReadState();
    const remainingDwellMs = getRemainingDwellMs();
    if (
      window.innerHeight + window.scrollY >=
      document.body.offsetHeight - 100
    ) {
      stopScrolling();
      if (remainingDwellMs > 0) {
        scheduleOpenNextTopic("已到底部，继续停留模拟阅读", remainingDwellMs);
        scheduleCheckScroll(Math.min(remainingDwellMs, delay));
      } else {
        console.log("[auto-read] 已到底部且停留时间已足够，打开下一篇");
        openNewTopic();
      }
    } else {
      const { distancePerStep, delayPerStep } = getScrollSettings();
      scrollToBottomSlowly(distancePerStep, delayPerStep);
      scheduleCheckScroll(delay);
    }
  }

  // 入口函数
  window.addEventListener("load", () => {
    checkFirstRun();
    console.log(
      "autoRead",
      localStorage.getItem("read"),
      "autoLikeEnabled",
      localStorage.getItem("autoLikeEnabled")
    );
    if (localStorage.getItem("read") === "true") {
      console.log("执行正常的滚动和检查逻辑");
      checkScroll();
      if (isAutoLikeEnabled()) {
        autoLike();
      }
    }
  });

  // 获取当前时间戳
  const currentTime = Date.now();
  // 获取存储的时间戳
  const defaultTimestamp = new Date("1999-01-01T00:00:00Z").getTime(); //默认值为1999年
  const storedTime = parseInt(
    localStorage.getItem("clickCounterTimestamp") ||
      defaultTimestamp.toString(),
    10
  );

  // 获取当前的点击计数，如果不存在则初始化为0
  let clickCounter = parseInt(localStorage.getItem("clickCounter") || "0", 10);
  // 检查是否超过24小时（24小时 = 24 * 60 * 60 * 1000 毫秒）
  if (currentTime - storedTime > 24 * 60 * 60 * 1000) {
    // 超过24小时，清空点击计数器并更新时间戳
    clickCounter = 0;
    localStorage.setItem("clickCounter", "0");
    localStorage.setItem("clickCounterTimestamp", currentTime.toString());
  }

  console.log(`Initial clickCounter: ${clickCounter}`);
  function triggerClick(button) {
    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      view: window,
    });
    button.dispatchEvent(event);
  }

  function getButtonDebugInfo(button) {
    const title = button.getAttribute("title") || "";
    const ariaLabel = button.getAttribute("aria-label") || "";
    const text = (button.textContent || "").trim().replace(/\s+/g, " ");
    const ariaPressed = button.getAttribute("aria-pressed") || "";
    const className =
      typeof button.className === "string" ? button.className : "";
    const label = [title, ariaLabel, text].filter(Boolean).join(" | ");
    return {
      title,
      ariaLabel,
      text,
      ariaPressed,
      className,
      label,
    };
  }

  function isAlreadyLikedButton(info) {
    if (info.ariaPressed === "true") {
      return true;
    }

    const negativePattern =
      /(unlike|取消|撤销|收回|已赞|已点赞|remove your reaction)/i;
    if (negativePattern.test(info.label)) {
      return true;
    }

    return /(has-reacted|user-reacted|reacted)/i.test(info.className);
  }

  function isLikelyLikeButton(info) {
    if (isAlreadyLikedButton(info)) {
      return false;
    }

    const positivePattern =
      /(点赞此帖子|点赞|Like this post|^like$|赞此帖|赞本帖|赞)/i;
    if (positivePattern.test(info.label)) {
      return true;
    }

    return info.label === "" && info.ariaPressed === "false";
  }

  function autoLike() {
    console.log(`[auto-read] Initial clickCounter: ${clickCounter}`);
    // 寻找所有的discourse-reactions-reaction-button
    const buttons = Array.from(document.querySelectorAll(
      ".discourse-reactions-reaction-button"
    ));
    if (buttons.length === 0) {
      console.error(
        "[auto-read] No buttons found with the selector '.discourse-reactions-reaction-button'"
      );
      return;
    }
    const buttonInfos = buttons.map((button, index) => ({
      button,
      index,
      info: getButtonDebugInfo(button),
    }));
    const likeCandidates = buttonInfos.filter(({ info }) =>
      isLikelyLikeButton(info)
    );
    console.log(
      `[auto-read] Found ${buttons.length} reaction buttons, ${likeCandidates.length} like candidates.`
    );
    if (likeCandidates.length === 0) {
      console.log(
        `[auto-read] Sample button labels: ${buttonInfos
          .slice(0, 5)
          .map(({ index, info }) => `#${index + 1}[${info.label || "empty"}]`)
          .join("; ")}`
      );
      return;
    }

    // 逐个点击找到的按钮
    likeCandidates.forEach(({ button, index, info }) => {
      if (clickCounter >= likeLimit) {
        return;
      }

      // 新增：点赞前加一个随机概率判断（如30%概率）
      const likeProbability = 0.3; // 0~1之间，0.3表示30%概率
      if (Math.random() > likeProbability) {
        console.log(
          `[auto-read] 跳过第${index + 1}个点赞候选按钮（未通过概率判断），label=${
            info.label || "empty"
          }`
        );
        return;
      }

      // 点赞间隔时间也随机（2~5秒之间）
      const randomDelay = 2000 + Math.floor(Math.random() * 3000);

      autoLikeInterval = setTimeout(() => {
        // 模拟点击
        triggerClick(button); // 使用自定义的触发点击方法
        console.log(
          `[auto-read] Clicked like button ${index + 1}, label=${
            info.label || "empty"
          }, delay=${randomDelay}ms`
        );
        clickCounter++; // 更新点击计数器
        localStorage.setItem(
          "autoReadLikeClickCount",
          clickCounter.toString()
        );
        localStorage.setItem("autoReadLastLikeAt", Date.now().toString());
        // 将新的点击计数存储到localStorage
        localStorage.setItem("clickCounter", clickCounter.toString());
        // 如果点击次数达到likeLimit次，则设置点赞变量为false
        if (clickCounter === likeLimit) {
          console.log(`[auto-read] Reached ${likeLimit} likes, disabling auto-like.`);
          localStorage.setItem("autoLikeEnabled", "false"); // 使用localStorage存储点赞变量状态
        } else {
          console.log(`[auto-read] clickCounter: ${clickCounter}`);
        }
      }, index * randomDelay); // 每次点赞的延迟为随机值
    });
  }
  const button = document.createElement("button");
  // 初始化按钮文本基于当前的阅读状态
  button.textContent =
    localStorage.getItem("read") === "true" ? "停止阅读" : "开始阅读";
  button.style.position = "fixed";
  button.style.bottom = "10px"; // 之前是 top
  button.style.left = "10px"; // 之前是 right
  button.style.zIndex = 1000;
  button.style.backgroundColor = "#f0f0f0"; // 浅灰色背景
  button.style.color = "#000"; // 黑色文本
  button.style.border = "1px solid #ddd"; // 浅灰色边框
  button.style.padding = "5px 10px"; // 内边距
  button.style.borderRadius = "5px"; // 圆角
  document.body.appendChild(button);

  button.onclick = function () {
    const currentlyReading = localStorage.getItem("read") === "true";
    const newReadState = !currentlyReading;
    localStorage.setItem("read", newReadState.toString());
    button.textContent = newReadState ? "停止阅读" : "开始阅读";
    if (!newReadState) {
      stopScrolling();
      clearPendingTopicOpen();
      if (checkScrollTimeout !== null) {
        clearTimeout(checkScrollTimeout);
        checkScrollTimeout = null;
      }
      localStorage.removeItem("navigatingToNextTopic");
    } else {
      // 如果是Linuxdo，就导航到我的帖子
      if (BASE_URL == "https://linux.do") {
        window.location.href = "https://linux.do/t/topic/13716/900";
      } else {
        window.location.href = `${BASE_URL}/t/topic/1`;
      }
      checkScroll();
    }
  };

  //自动点赞按钮
  // 在页面上添加一个控制自动点赞的按钮
  const toggleAutoLikeButton = document.createElement("button");
  toggleAutoLikeButton.textContent = isAutoLikeEnabled()
    ? "禁用自动点赞"
    : "启用自动点赞";
  toggleAutoLikeButton.style.position = "fixed";
  toggleAutoLikeButton.style.bottom = "50px"; // 之前是 top，且与另一个按钮错开位置
  toggleAutoLikeButton.style.left = "10px"; // 之前是 right
  toggleAutoLikeButton.style.zIndex = "1000";
  toggleAutoLikeButton.style.backgroundColor = "#f0f0f0"; // 浅灰色背景
  toggleAutoLikeButton.style.color = "#000"; // 黑色文本
  toggleAutoLikeButton.style.border = "1px solid #ddd"; // 浅灰色边框
  toggleAutoLikeButton.style.padding = "5px 10px"; // 内边距
  toggleAutoLikeButton.style.borderRadius = "5px"; // 圆角
  document.body.appendChild(toggleAutoLikeButton);

  // 为按钮添加点击事件处理函数
  toggleAutoLikeButton.addEventListener("click", () => {
    const isEnabled = !isAutoLikeEnabled();
    setAutoLikeEnabled(isEnabled);
    toggleAutoLikeButton.textContent = isEnabled
      ? "禁用自动点赞"
      : "启用自动点赞";
  });
  // 判断是否启用自动点赞
  function isAutoLikeEnabled() {
    // 从localStorage获取autoLikeEnabled的值，如果未设置，默认为"true"
    return localStorage.getItem("autoLikeEnabled") !== "false";
  }

  // 设置自动点赞的启用状态
  function setAutoLikeEnabled(enabled) {
    localStorage.setItem("autoLikeEnabled", enabled ? "true" : "false");
  }
})();
