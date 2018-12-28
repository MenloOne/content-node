
#### Creating a Content Node box on AWS

* Launch an EC2 box with Ubuntu
* Make sure it has an EBS instance associated with it of at least 2 Terrabytes
* Setup security groups appropriately

You can follow the [IPFS AWS Tutorial](https://medium.com/textileio/tutorial-setting-up-an-ipfs-peer-part-i-de48239d82e0)

Note: For almost all of these commands you have to be root - therefore, I would suggest doing `sudo bash` at the beginning and running the rest of the commands as `root`

```
    sudo bash
```

##### Initialize and mount the EBS volume

```
    lsblk
```

Lists out the devices you have on the EC2 instance.  For example:'

```
NAME        MAJ:MIN RM  SIZE RO TYPE MOUNTPOINT
loop0         7:0    0 87.9M  1 loop /snap/core/5328
loop1         7:1    0 12.7M  1 loop /snap/amazon-ssm-agent/495
nvme0n1     259:0    0  100G  0 disk 
└─nvme0n1p1 259:1    0  100G  0 part /
nvme1n1     259:2    0    3T  0 disk 
```

In this example, it's nvme1n1 that is a 3T volume type disk but that has not yet been mounted.  It will not have a file system on it initially which you can check and verify with the command 

```
> file -s /dev/nvme1n
/dev/nvme1n1: data
``` 

The response is `data` because there is no file system.  So, lets initialize a file system and mount the drive

```
> mkfs -t ext4 /dev/nvme1n1
> mkdir /data
> file -s /dev/nvme0n1p1
/dev/nvme1n1: Linux rev 1.0 ext4 filesystem data, UUID=12f0dd42-6a60-4966-a62a-e3134c706cae (extents) (64bit) (large files) (huge files)
```

You will see a UUID listed as the unique ID of this device.  Use that to mount it in fstab in order to mount the volume on every reboot

```
cat >> /etc/fstab <<EOL
/dev/disk/by-uuid/12f0dd42-6a60-4966-a62a-e3134c706cae /data ext4 defaults,nofail 0 2 
EOL
mount -a
```

##### Install Golang and IPFS

```
apt-get update -y
apt-get install -y golang

wget https://dist.ipfs.io/go-ipfs/v0.4.15/go-ipfs_v0.4.15_linux-amd64.tar.gz
tar -xvf go-ipfs_v0.4.15_linux-amd64.tar.gz
```
   
##### Move executable to your bin path

```
mv go-ipfs/ipfs /usr/local/bin
rm -rf go-ipfs
``` 

#### Initialize IPFS 

```
echo 'export IPFS_PATH=/data/ipfs' >>~/.bash_profile
source ~/.bash_profile
mkdir -p $IPFS_PATH
ipfs init -p server
```


#### Configure IPFS Limits & CORS

```
ipfs config Datastore.StorageMax 20GB
ipfs config Addresses.API /ip4/127.0.0.1/tcp/5001
ipfs config --json API.HTTPHeaders.Access-Control-Allow-Origin '["*"]'
ipfs config --json API.HTTPHeaders.Access-Control-Allow-Methods '["PUT", "GET", "POST"]'
ipfs config --json Addresses.Swarm '["/ip4/0.0.0.0/tcp/4001", "/ip4/0.0.0.0/tcp/8081/ws", "/ip6/::/tcp/4001"]' 
ipfs config --bool Swarm.EnableRelayHop true
```

#### To surface the gateway over HTTP

``` 
ipfs config Addresses.Gateway /ip4/0.0.0.0/tcp/8080
```

#### Copy and paste unit file definition

``` 
cat >/lib/systemd/system/ipfs.service <<EOL
[Unit]
Description=ipfs daemon
[Service]
ExecStart=/usr/local/bin/ipfs daemon --enable-gc
Restart=always
User=root
Group=root
Environment="IPFS_PATH=/data/ipfs"
[Install]
WantedBy=multi-user.target
EOL
```

   
#### Start IPFS

```
systemctl daemon-reload
systemctl enable ipfs
systemctl start ipfs.service
```

You can now reboot your instance and make sure IPFS is running by:

```
systemctl restart ipfs
systemctl status ipfs
```

#### Get Certbot to get an SSL Cert

From [https://certbot.eff.org/](https://certbot.eff.org/)

```
apt-get install -y software-properties-common
add-apt-repository ppa:certbot/certbot
apt-get update -y
apt-get install -y python-certbot-nginx
```

#### Use CertBot to get your SSLs for IPFS.menlo.one and CN.menlo.one

First point cn.menlo.one (or your domain) to your AWS box.  Then:

```
cat >/etc/nginx/sites-available/default <<EOL
EOL 
certbot --nginx -d cn.menlo.one
certbot --nginx -d ipfs.menlo.one
```

#### Setup automatic SSL renewals

``` 
cat >/etc/console-setup/renew-cert <<EOL
#!/bin/bash
certbot renew --noninteractive
EOL
chmod +x /etc/console-setup/renew-cert
```

#### Configure NGINGX

```
cat >/etc/nginx/sites-available/default <<EOL
server {
    server_name ipfs.menlo.one;
    listen [::]:4002 ssl ipv6only=on;
    listen 4002 ssl;
    ssl_certificate /etc/letsencrypt/live/ipfs.menlo.one/fullchain.pem; # managed by Certbot
    ssl_certificate_key /etc/letsencrypt/live/ipfs.menlo.one/privkey.pem; # managed by Certbot
    include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; # managed by Certbot
    location / {
        proxy_pass http://127.0.0.1:5001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
server {
    server_name ipfs.menlo.one;
    listen 80 ;
    listen [::]:80 ;
    if (\$host = ipfs.menlo.one) {
        return 301 https://\$host\$request_uri;
    } # managed by Certbot
    return 404; # managed by Certbot
}
server {
    server_name cn.menlo.one; # managed by Certbot
    listen [::]:443 ssl ipv6only=on; # managed by Certbot
    listen 443 ssl; # managed by Certbot
    location / {
        # redirect all HTTPS traffic to localhost:5005
        proxy_pass http://127.0.0.1:5005;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        
        # WebSocket support
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$http_connection;        
    }
    location /socket.io {
        # redirect all HTTPS traffic to localhost:5005
        proxy_pass http://127.0.0.1:5005;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        
        # WebSocket support
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$http_connection;        
    }
    ssl_certificate /etc/letsencrypt/live/cn.menlo.one/fullchain.pem; # managed by Certbot
    ssl_certificate_key /etc/letsencrypt/live/cn.menlo.one/privkey.pem; # managed by Certbot
    include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; # managed by Certbot
}
server {
    server_name cn.menlo.one;
    listen 80 ;
    listen [::]:80 ;
    if (\$host = cn.menlo.one) {
        return 301 https://\$host\$request_uri;
    } # managed by Certbot
    return 404; # managed by Certbot
}
EOL
```

#### Test CORS

You can test this config by doing:

``` 
curl -H "Origin: http://expo.menlo.com" \
-H "Access-Control-Request-Method: POST" \
-H "Access-Control-Request-Headers: X-Requested-With" \
--verbose \
http://0.0.0.0:5001/api/v0/swarm/peers; echo
```

#### Restart NGINX

``` 
systemctl restart nginx
```


## Install GETH

```
add-apt-repository -y ppa:ethereum/ethereum
apt-get update -y
apt-get install -y ethereum

echo 'export RINKEBY_PATH=/data/geth/rinkeby' >>~/.bash_profile
echo 'export MAINNET_PATH=/data/geth/mainnet' >>~/.bash_profile
source ~/.bash_profile

cat >/lib/systemd/system/geth.service <<EOL
[Unit]
Description=geth node
[Service]
ExecStart=/usr/bin/geth --syncmode "fast" --rpc --rpcapi db,eth,net,web3,personal --ws --wsorigins "*" --cache=1024 --rpcport 8545 --rpcaddr 127.0.0.1 --rpccorsdomain "*" --datadir /data/geth/mainnet --mine --etherbase "0x5421a9B25218f3566c11e5D350aa91369627764B"
Restart=always
User=root
Group=root
[Install]
WantedBy=multi-user.target
EOL

systemctl daemon-reload
systemctl enable geth
systemctl start geth.service
```

##### To interact with Geth

Viewing the log: `journalctl -f -t geth`

Attaching to the console: `geth --datadir=$MAINNET_PATH attach ipc:$MAINNET_PATH/geth.ipc console`

#### Rudimentary track of sync

Attach to the geth console and enter this script
```
var lastPercentage = 0;var lastBlocksToGo = 0;var timeInterval = 10000;
setInterval(function(){
    var percentage = eth.syncing.currentBlock/eth.syncing.highestBlock*100;
    var percentagePerTime = percentage - lastPercentage;
    var blocksToGo = eth.syncing.highestBlock - eth.syncing.currentBlock;
    var bps = (lastBlocksToGo - blocksToGo) / (timeInterval / 1000)
    var etas = 100 / percentagePerTime * (timeInterval / 1000)

    var etaM = parseInt(etas/60,10);
    console.log(parseInt(percentage,10)+'% ETA: '+etaM+' minutes @ '+bps+'bps');

    lastPercentage = percentage;lastBlocksToGo = blocksToGo;
},timeInterval);
```

#### Install and build Content Node software


```
mkdir /data/content-node
chown ubuntu:ubuntu /data/content-node
```

* Exit out of sudo bash

```
cd /data/content-node
git init
git remote add origin https://github.com/MenloOne/content-node.git 
git pull origin master
```

Then...

```
sudo bash
apt install nodejs
apt install npm
npm i -g npm@5.6.0
npm i
npm run build
```

#### Make CN a service

```
cat >/lib/systemd/system/cn.service <<EOL
[Unit]
Description=content node daemon
[Service]
ExecStart=/usr/local/bin/npm start --prefix /data/content-node
Restart=always
User=root
Group=root
Environment=""
[Install]
WantedBy=multi-user.target
EOL
systemctl daemon-reload
systemctl enable cn
systemctl start cn
```
