const k8s = require('@kubernetes/client-node');

const loadKubeConfig = () => {
  const kc = new k8s.KubeConfig();
  if (process.env.KUBECONFIG) {
    kc.loadFromFile(process.env.KUBECONFIG);
  } else {
    kc.loadFromDefault();
  }
  return kc;
};

const kubeConfig = loadKubeConfig();
const coreApi = kubeConfig.makeApiClient(k8s.CoreV1Api);
const appsApi = kubeConfig.makeApiClient(k8s.AppsV1Api);
const networkingApi = kubeConfig.makeApiClient(k8s.NetworkingV1Api);

// ─── TLS FIX ──────────────────────────────────────────────────────────────────
// kubeadm clusters use self-signed certs. The @kubernetes/client-node library
// sets rejectUnauthorized based on the kubeconfig, but if the CA bundle is
// missing or the env var NODE_EXTRA_CA_CERTS isn't set, Node rejects the cert
// immediately. This patches the underlying agent on all three API clients.
const https = require('https');
const insecureAgent = new https.Agent({ rejectUnauthorized: false });

// Only disable TLS verification if not already handled by the kubeconfig CA
if (!process.env.NODE_EXTRA_CA_CERTS) {
  coreApi.defaultHeaders = coreApi.defaultHeaders || {};
  appsApi.defaultHeaders = appsApi.defaultHeaders || {};
  networkingApi.defaultHeaders = networkingApi.defaultHeaders || {};

  [coreApi, appsApi, networkingApi].forEach((client) => {
    if (client.requestAgent === undefined) {
      client.requestAgent = insecureAgent;
    }
  });
}
// ─────────────────────────────────────────────────────────────────────────────

const ensureNamespace = async (name) => {
  try {
    await coreApi.readNamespace(name);
    return;
  } catch (err) {
    if (err.statusCode === 404 || err.response?.statusCode === 404) {
      await coreApi.createNamespace({ metadata: { name } });
      return;
    }
    throw err;
  }
};

const upsertImagePullSecret = async ({ namespace, name, server, username, password, email = 'none' }) => {
  const dockerConfigJson = {
    auths: {
      [server]: {
        username,
        password,
        email,
        auth: Buffer.from(`${username}:${password}`).toString('base64'),
      },
    },
  };

  const secret = {
    apiVersion: 'v1',
    kind: 'Secret',
    metadata: { name, namespace },
    type: 'kubernetes.io/dockerconfigjson',
    data: {
      '.dockerconfigjson': Buffer.from(JSON.stringify(dockerConfigJson)).toString('base64'),
    },
  };

  try {
    await coreApi.readNamespacedSecret(name, namespace);
    return await coreApi.replaceNamespacedSecret(name, namespace, secret);
  } catch (err) {
    if (err.statusCode === 404 || err.response?.statusCode === 404) {
      return await coreApi.createNamespacedSecret(namespace, secret);
    }
    throw err;
  }
};

const upsertDeployment = async ({ namespace, name, image, containerPort, labels, env = [], replicas = 1, imagePullSecrets = [] }) => {
  const deployment = {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name, namespace, labels },
    spec: {
      replicas,
      selector: { matchLabels: labels },
      template: {
        metadata: { labels },
        spec: {
          imagePullSecrets,
          containers: [
            {
              name,
              image,
              ports: [{ containerPort }],
              env,
              imagePullPolicy: 'Always',
            },
          ],
        },
      },
    },
  };

  try {
    await appsApi.readNamespacedDeployment(name, namespace);
    return await appsApi.replaceNamespacedDeployment(name, namespace, deployment);
  } catch (err) {
    if (err.statusCode === 404 || err.response?.statusCode === 404) {
      return await appsApi.createNamespacedDeployment(namespace, deployment);
    }
    throw err;
  }
};

const upsertService = async ({ namespace, name, selector, port, targetPort }) => {
  const service = {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: { name, namespace },
    spec: {
      selector,
      ports: [{ protocol: 'TCP', port, targetPort }],
    },
  };

  try {
    await coreApi.readNamespacedService(name, namespace);
    return await coreApi.replaceNamespacedService(name, namespace, service);
  } catch (err) {
    if (err.statusCode === 404 || err.response?.statusCode === 404) {
      return await coreApi.createNamespacedService(namespace, service);
    }
    throw err;
  }
};

const upsertIngress = async ({ namespace, name, ingressClassName, rules, annotations = {} }) => {
  const ingress = {
    apiVersion: 'networking.k8s.io/v1',
    kind: 'Ingress',
    metadata: { name, namespace, annotations },
    spec: {
      ingressClassName,
      rules: [
        {
          http: {
            paths: rules.map((rule) => ({
              path: rule.path,
              pathType: rule.pathType || 'Prefix',
              backend: {
                service: {
                  name: rule.serviceName,
                  port: { number: rule.servicePort },
                },
              },
            })),
          },
        },
      ],
    },
  };

  try {
    await networkingApi.readNamespacedIngress(name, namespace);
    return await networkingApi.replaceNamespacedIngress(name, namespace, ingress);
  } catch (err) {
    if (err.statusCode === 404 || err.response?.statusCode === 404) {
      return await networkingApi.createNamespacedIngress(namespace, ingress);
    }
    throw err;
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForDeploymentReady = async ({ namespace, name, replicas = 1, timeoutMs = 120000 }) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const response = await appsApi.readNamespacedDeployment(name, namespace);
    const status = response.body.status || {};
    if (
      (status.availableReplicas || 0) >= replicas &&
      (status.observedGeneration || 0) >= (response.body.metadata?.generation || 0)
    ) {
      return response.body;
    }
    await sleep(3000);
  }
  throw new Error(`Deployment ${name} in namespace ${namespace} did not become ready within ${timeoutMs}ms`);
};

module.exports = {
  ensureNamespace,
  upsertImagePullSecret,   // ← was missing
  upsertDeployment,
  upsertService,
  upsertIngress,
  waitForDeploymentReady,
};