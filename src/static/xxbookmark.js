// ==UserScript==
// @name         拦截请求
// @namespace    http://tampermonkey.net/
// @version      2025-01-09
// @description  try to take over the world!
// @author       You
// @match        https://x.com/i/bookmarks
// @icon         https://www.google.com/s2/favicons?sz=64&domain=x.com
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // Your code here...

  const dataList = [];
  const errorList = [];
  let oldOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, async, user, password) {
    // 拦截open
    // console.log('sirus', url)
    return oldOpen.apply(this, arguments);
  }

  let oldSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (data) {
    // console.log(data) // 发送请求的data
    this.addEventListener('readystatechange', function () {
      // 拦截response
      if (this.readyState === 4 && /Bookmarks/.test(this.responseURL)) {
        const checkList = []
        const idSet = new Set()
        const data = JSON.parse(this.response)
        const entries = data.data.bookmark_timeline_v2.timeline.instructions[0].entries
        entries.forEach((entry, index) => {
          try {
            // 取值
            let result = entry.content.itemContent.tweet_results.result;
            result = result.__typename === 'Tweet' ? result : result.tweet
            const userInfo = result.core.user_results.result.legacy
            const mediaInfo = result.legacy.entities.media ?? result.quoted_status_result?.result.legacy.entities.media
            // 组装
            if (idSet.has(result.legacy.id_str)) {
              console.log('重复');
            }
            idSet.add(result.legacy.id_str)
            checkList.push(userInfo.name, userInfo.screen_name, result.legacy.id_str, result.legacy.full_text, result.legacy.created_at)
            if (!mediaInfo) {
              console.log(result);
            }
            mediaInfo.forEach((node) => {
              checkList.push(node.type, node.media_url_https, node.sizes)
              // if (node.type !== 'photo') {
              //   console.log('type', node.type, node);
              // }
              if (node.type === 'video') {
                checkList.push(node.video_info.variants)
              }
            })
            // 检查是否为空
            for (let i = 0, len = checkList.length; i < len; i++) {
              const value = checkList[i]
              if (!value) {
                console.log('空！', result, value);
                break;
              }
            }
            dataList.push({
              id: result.legacy.id_str,
              full_text: result.legacy.full_text,
              created_at: result.legacy.created_at,
              user: {
                name: userInfo.name,
                screen_name: userInfo.screen_name,
                profile_banner_url: userInfo.profile_banner_url,
                profile_image_url_https: userInfo.profile_image_url_https,
              },
              media: mediaInfo.map((node) => {
                return {
                  url: node.url,
                  type: node.type,
                  media_url_https: node.media_url_https,
                  sizes: node.sizes,
                  video_info: node.video_info?.variants
                }
              })
            })
          } catch (e) {
            if (!/reading 'tweet_results'/.test(e.message)) {
              errorList.push(e)
            }
          }
        })
      }
    }, false);
    return oldSend.apply(this, arguments);
  }

  // 自动滚动
  let isInLooping = true;
  window.startLooping = function () {
    isInLooping = true;
    setTimeout(() => {
      main()
    }, 2000)
  }

  window.stopLooping = function () {
    isInLooping = false;
    console.log(dataList, errorList);
  }

  async function thread() {
    return new Promise((resolve) => {
      window.scrollTo(0, document.documentElement.scrollTop + 1000)
      setTimeout(() => {
        resolve()
      }, 100)
    })
  }

  async function main() {
    while (isInLooping) {
      await thread()
    }
  }

  window.startLooping()

})();