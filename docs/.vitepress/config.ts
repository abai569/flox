import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'FLVX 文档',
  titleTemplate: ':title – FLVX 官方文档',
  description: '高性能流量转发管理系统',
  lang: 'zh-CN',
  base: '/flvx/',
  ignoreDeadLinks: true,
  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '安装部署', link: '/install' },
      { text: '使用指南', link: '/usage' },
      { text: 'AI Skill 接入', link: '/ai-skill' },
      { text: 'PostgreSQL', link: '/postgresql' },
      { text: '常见问题', link: '/faq' },
    ],
    sidebar: {
      '/': [
        { text: '安装部署', link: '/install' },
        { text: '使用指南', link: '/usage' },
        { text: 'PostgreSQL', link: '/postgresql' },
        { text: 'AI Skill 接入', link: '/ai-skill' },
        { text: '常见问题', link: '/faq' },
      ],
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/abai569/flvx' },
    ],
    search: {
      provider: 'local',
    },
    footer: {
      message: '基于 MIT 协议发布',
      copyright: 'Copyright © 2024 FLVX',
    },
  },
})
