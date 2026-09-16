import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'architxt',
  tagline: 'Documents → Contextual Graph → Insight',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: 'https://architxt.example.com',
  baseUrl: '/',

  organizationName: 'team-oc',
  projectName: 'architxt',

  onBrokenLinks: 'throw',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
          editUrl:
            'http://192.168.1.201:30142/team-oc/architxt/-/blob/feat/docv1/architxt-docs/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  stylesheets: [
    {
      href: '/css/infima-overrides.css',
      type: 'text/css',
    },
  ],

  themeConfig: {
    image: 'img/favicon.ico',
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'architxt',
      logo: {
        alt: 'architxt',
        src: 'img/logo.svg',
      },
      items: [
        {
          href: 'https://github.com/garethjcooper/architxt',
          position: 'right',
          className: 'header-github-link',
          'aria-label': 'GitHub repository',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {
              label: 'Introduction',
              to: '/',
            },
            {
              label: 'Installation',
              to: '/getting-started/installation',
            },
          ],
        },
        {
          title: 'Project',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/garethjcooper/architxt',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} architxt. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
