// ==UserScript==
// @name         下载 x bookmark
// @namespace    http://tampermonkey.net/
// @version      2024-12-29
// @description  try to take over the world!
// @author       You
// @match        https://x.com/i/bookmarks
// @icon         https://www.google.com/s2/favicons?sz=64&domain=x.com
// @grant        none
// ==/UserScript==

(function () {
    'use strict';
    function getNodeList(queryStr, target) {
        target = target ?? document
        const nodeList = target.querySelectorAll(queryStr)
        return Array.from(nodeList)
    }
    function getStorageMap(key) {
        let map = new Map()
        try {
            const str = window.localStorage.getItem(key) ?? '{}'
            const obj = JSON.parse(str)
            map = new Map(Object.entries(obj))
        } catch (e) { }
        return map
    }
    function setStorageMap(key, map) {
        try {
            const str = JSON.stringify(Object.fromEntries(map))
            window.localStorage.setItem(key, str)
        } catch (e) { }
        return map
    }
    function getArticleInfo() {
        return getNodeList('article[data-testid=tweet]').map((node) => {
            const node1 = node.querySelector('[data-testid=tweetText]')
            const node2 = node.querySelectorAll('[data-testid=tweetPhoto]')
            const node3 = node.querySelector('[data-testid=videoComponent]')
            // 计算 id
            const a = node.querySelector('a[href*=status]')
            const match = a.href.match(/\/([^\/]+)\/status\/(\d+)/)
            const id = `${match[1]}_${match[2]}`
            // 计算 text
            const text = node1 ? node1.innerText : ''
            // 计算 photo
            const photoList = []
            if (node2 && !node3) {
                // 有视频的就没有图片
                const imgList = getNodeList('img[alt=Image]', node).map((img) => {
                    return img.src
                })
                photoList.push(...imgList)
            }
            // 验证是否有问题
            const isValid = node3 || node2.length === photoList.length

            const nodeInfo = {
                isValid,
                node,
                id,
                text,
                photoList,
            };

            return nodeInfo
        })
    }

    const storageKey = 'sirusbookmarks'
    const workingMap = getStorageMap(storageKey)
    const scrollLength = 2000;
    console.log('init', workingMap);

    let isInLooping = true;
    window.stopLooping = function () {
        isInLooping = false;
    }

    function thread() {
        return new Promise((resolve) => {
            let nextPosition = scrollLength;
            const infoList = getArticleInfo()
            for (let i = 0, len = infoList.length; i < len; i++) {
                const info = infoList[i]
                // 入库
                if (!workingMap.has(info.id)) {
                    if (info.isValid) {
                        workingMap.set(info.id, {
                            id: info.id,
                            text: info.text,
                            photoList: info.photoList,
                        })
                    } else {
                        // 未录入并且并可用，回头再次加载看能不能行
                        nextPosition -= scrollLength;
                    }
                }
            }
            console.log(workingMap);
            setStorageMap(storageKey, workingMap)
            window.scrollTo(0, document.documentElement.scrollTop + nextPosition)
            setTimeout(() => {
                resolve()
            }, 1000)
        })
    }

    async function main() {
        while (isInLooping) {
            await thread()
        }
    }

    main()
})();