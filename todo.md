1. 更新输出的文件格式，补充 论文 PDF 链接、论文 包含摘要的页面 截图
    a) 你应该获取 abstract 的纯文本
    b) 你应该在本地获取 PDF 文件，然后通过你认为好的工具来进行 PDF 的文本化，并通过此来定位对应的页面；
    c) 然后你应该对 PDF 进行截图，并且应该是一个清晰的截图，最短边分辨率不低于1000px
2. verify目前 根据 调用这个 github action 的仓库 中 .env中指定路径 中所有 markdown 的 yaml front matter 中指定的 member 的 orcid 来获取 publications, if not completed, 补全这个逻辑
3. 更新 README 并修复 docs/code-review.md 中所有的问题
4. 尝试让这个代码能在本地而不只是 github actions 环境中运行，用于测试拉取的功能
5. 为这个项目创建完整的 单元测试，覆盖所有功能点，支持进行 mock 测试并验证包括拉取在内的所有功能
6. 针对本地运行，你应该创建.env.development文件，并指定相关的输出路径。
7. 完成所有消息后，通过/notify-feishu 通知我。如果你有任何需要我 confirm 的信息（即你触发了ask_question），也通过它通知我


1. 