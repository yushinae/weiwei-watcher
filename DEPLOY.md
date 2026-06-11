# 部署手册（Hostinger VPS · Ubuntu 24.04）

目标：一台 VPS 跑全部 —— Caddy（HTTPS + 静态前端 + 反代）+ Node 后端（用户体系/key 保管库/签名代理）+ Postgres。
单域名部署，前后端同源，cookie 零配置。VPS 的固定 IP 就是交易所 API 白名单里填的 IP。

## 分支策略

- `main`＝个人本地版（纯前端日常使用，不部署）；`product`＝产品版（用户体系/多租户，VPS 只从它部署）。
- 同步**只有一个方向：main → product**（`git checkout product && git merge main`），把日常改进带进产品。
  绝不反向合并，product 独有的东西不回流 main——这是两条分支不打架的唯一规则。

## 0. 准备

- Hostinger hPanel → VPS → 操作系统：重装为 **Ubuntu 24.04 LTS（纯净版，不带面板）**，记下 root 密码和 IP。
- 域名 DNS：加一条 A 记录 `app.你的域名.com → VPS IP`。
  用 Cloudflare 管 DNS 的话**先灰云（仅 DNS）**，全部跑通后再开橙云。
- 本地能 `ssh root@VPS_IP` 登录即可开始。

## 1. 初始化（root 执行，一次性）

```bash
adduser app && usermod -aG sudo app
ufw allow 22,80,443/tcp && ufw enable

curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs postgresql caddy git

# 建数据库（密码自己定，记下来）
sudo -u postgres psql -c "CREATE USER app WITH PASSWORD '改成你的密码';"
sudo -u postgres createdb weiwei -O app
```

## 2. 拉代码 + 构建（app 用户执行）

```bash
su - app
git clone -b product https://github.com/yushinae/weiwei-react.git weiwei && cd weiwei
npm ci && (cd server && npm ci)
npm run build        # 前端 → dist/（生产构建默认强制登录）
```

仓库是私有的话，clone 用 GitHub 的 fine-grained token（仓库设置 → Deploy keys 或 PAT）。

## 3. 后端环境变量

`/home/app/weiwei/.env.server`（`chmod 600`）：

```bash
DATABASE_URL=postgres://app:改成你的密码@localhost:5432/weiwei
BETTER_AUTH_SECRET=$(openssl rand -hex 32 的输出)
KEY_ENCRYPTION_KEY=$(openssl rand -hex 32 的输出)   # API key 加密主密钥，丢了密文全废，备份好
BETTER_AUTH_URL=https://app.你的域名.com
AUTH_TRUSTED_ORIGINS=https://app.你的域名.com
```

## 4. systemd 托管后端（root 执行）

`/etc/systemd/system/weiwei.service`：

```ini
[Unit]
Description=weiwei backend
After=network.target postgresql.service

[Service]
User=app
WorkingDirectory=/home/app/weiwei
EnvironmentFile=/home/app/weiwei/.env.server
ExecStart=/usr/bin/npx tsx server/index.ts
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
systemctl enable --now weiwei
journalctl -u weiwei -f     # 应看到 "Postgres 已连接" + "running at 8787"
```

## 5. Caddy（HTTPS + 前端 + 反代）

`/etc/caddy/Caddyfile` 整体替换为（vite.config.ts 里的 dev 代理在生产由这里等价承担）：

```
app.你的域名.com {
    encode gzip

    handle /api/* {
        reverse_proxy localhost:8787
    }

    handle_path /bybit-api/* {
        reverse_proxy https://api.bybit.com { header_up Host api.bybit.com }
    }
    handle_path /binance-api/* {
        reverse_proxy https://data-api.binance.vision { header_up Host data-api.binance.vision }
    }
    handle_path /binance-spot-api/* {
        reverse_proxy https://api.binance.com { header_up Host api.binance.com }
    }
    handle_path /binance-fapi/* {
        reverse_proxy https://fapi.binance.com { header_up Host fapi.binance.com }
    }
    handle_path /hyperliquid-api/* {
        reverse_proxy https://api.hyperliquid.xyz { header_up Host api.hyperliquid.xyz }
    }
    handle /deribit-ws* {
        rewrite * /ws/api/v2
        reverse_proxy https://www.deribit.com { header_up Host www.deribit.com }
    }
    handle /bybit-ws-option* {
        rewrite * /v5/public/option
        reverse_proxy https://stream.bybit.com { header_up Host stream.bybit.com }
    }

    handle {
        root * /home/app/weiwei/dist
        try_files {path} /index.html
        file_server
    }
}
```

```bash
systemctl reload caddy
```

打开 `https://app.你的域名.com` → 应跳到登录页 → 注册第一个账户 → 设置页添加交易所 key。

## 6. 必做配套

```bash
# 每天 4 点备份数据库到本地（之后可加 rclone 推 R2/S3 异地）
(crontab -u app -l 2>/dev/null; echo "0 4 * * * pg_dump weiwei | gzip > /home/app/backup-\$(date +\%F).sql.gz") | crontab -u app -
```

- 交易所后台：把 **VPS 的 IP** 填进每个 API key 的白名单。
- `.env.server` 里两个密钥（BETTER_AUTH_SECRET / KEY_ENCRYPTION_KEY）抄一份存密码管理器。

## 7. 日常更新

```bash
ssh app@VPS_IP 'cd weiwei && git pull && npm ci && (cd server && npm ci) && npm run build && sudo systemctl restart weiwei'
```

## 8. 本地开发（对照）

- 不用装任何数据库：不设 `DATABASE_URL` 时后端自动用 PGlite（嵌入式 Postgres，数据在 `server/data/pg/`，已 gitignore）。
- `npm run dev` 照旧同启前后端；开发模式默认**不**强制登录（要测登录门：`.env` 加 `VITE_AUTH_REQUIRED=1`）。
- 生产构建（`npm run build`）默认强制登录；想关：构建时 `VITE_AUTH_REQUIRED=0`。
