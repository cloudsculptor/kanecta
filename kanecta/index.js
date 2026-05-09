#!/usr/bin/env node

console.log(`
  Kanecta — Open Source Connectivity Platform
  https://kanecta.org

  Self-host with Docker:

    docker run -d \\
      --name kanecta \\
      -p 8080:8080 \\
      kanecta/kanecta:latest

  Or run from source:

    git clone https://github.com/cloudsculptor/kanecta
    cd kanecta

    # Start the API
    cd kanecta-api && npm install && npm start

    # Start the web client (in a separate terminal)
    cd kanecta-client-web && npm install && npm run dev

  More info:

    GitHub:  https://github.com/cloudsculptor/kanecta
    Docs:    https://kanecta.org
`);
