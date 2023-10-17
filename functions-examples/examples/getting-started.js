const {
  ResponseListener,
  ReturnType,
  decodeResult,
  FulfillmentCode,
  SecretsManager
} = require("@chainlink/functions-toolkit");
const functionsConsumerAbi = require("../abi/functionsClient.json");
const ethers = require("ethers");
require("@chainlink/env-enc").config();
const fs = require("fs");
const path = require("path");


///////////////////////////////////// CHANGE THESE ///////////////////////////////////// 
const consumerAddress = "0xb670Bf91d2EB8Ddd543CF2Db633166ab8Cb427C9"; // REPLACE this with your Functions consumer address
const subscriptionId = 422; // REPLACE this with your subscription ID
const secrets = { apiKey: process.env.OPENAI_KEY }
const args = ["tell me a dad joke"];

// hardcoded for Polygon Mumbai
const makeRequestMumbai = async () => {
  const routerAddress = "0x6E2dc0F9DB014aE19888F539E59285D2Ea04244C";
  const donId = "fun-polygon-mumbai-1";
  const explorerUrl = "https://mumbai.polygonscan.com";
  const slotIdNumber = 0; // slot ID where to upload the secrets
  const gatewayUrls = [
    "https://01.functions-gateway.testnet.chain.link/",
    "https://02.functions-gateway.testnet.chain.link/",
  ];
  const expirationTimeMinutes = 15; // expiration time in minutes of the secrets

  //   const source = `
  //   const prompt = args[0];

  //   if (!secrets.apiKey) {
  //       throw Error("Need to set OPENAI_KEY environment variable");
  //   }

  //   const openAIRequest = Functions.makeHttpRequest({
  //       url: "https://api.openai.com/v1/chat/completions",
  //       method: "POST",
  //       headers: {
  //           'Authorization': \`Bearer \${secrets.apiKey}\`,
  //           'Content-Type': 'application/json'
  //       },
  //       data: JSON.stringify({
  //           "model": "gpt-3.5-turbo",
  //           "messages": [{"role": "user", "content": "Say this is a test!"}],
  //           "temperature": 0,
  //       })
  //   });

  //   const [openAiResponse] = await Promise.all([openAIRequest]);

  //   const result = openAiResponse.data.choices[0].message.content;

  //   console.log(result);
  //   return Functions.encodeString(result);
  // `;

  const source = fs
    .readFileSync(path.resolve(__dirname, "source.js"))
    .toString();

  const gasLimit = 300000;

  //////// MAKE REQUEST ////////

  console.log("\nMake a Chainlink Functions request...");
  const privateKey = process.env.PRIVATE_KEY; // fetch PRIVATE_KEY
  if (!privateKey)
    throw new Error(
      "private key not provided - check your environment variables"
    );

  const rpcUrl = process.env.POLYGON_MUMBAI_RPC_URL; // fetch mumbai RPC URL

  if (!rpcUrl)
    throw new Error(`rpcUrl not provided  - check your environment variables`);

  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);

  const wallet = new ethers.Wallet(privateKey);
  const signer = wallet.connect(provider); // create ethers signer for signing transactions

  // First encrypt secrets and upload the encrypted secrets to the DON
  const secretsManager = new SecretsManager({
    signer: signer,
    functionsRouterAddress: routerAddress,
    donId: donId,
  });
  await secretsManager.initialize();

  // Encrypt secrets and upload to DON
  const encryptedSecretsObj = await secretsManager.encryptSecrets(secrets);

  console.log(
    `Upload encrypted secret to gateways ${gatewayUrls}. slotId ${slotIdNumber}. Expiration in minutes: ${expirationTimeMinutes}`
  );
  // Upload secrets
  const uploadResult = await secretsManager.uploadEncryptedSecretsToDON({
    encryptedSecretsHexstring: encryptedSecretsObj.encryptedSecrets,
    gatewayUrls: gatewayUrls,
    slotId: slotIdNumber,
    minutesUntilExpiration: expirationTimeMinutes,
  });

  if (!uploadResult.success)
    throw new Error(`Encrypted secrets not uploaded to ${gatewayUrls}`);

  console.log(
    `\n✅ Secrets uploaded properly to gateways ${gatewayUrls}! Gateways response: `,
    uploadResult
  );

  const donHostedSecretsVersion = parseInt(uploadResult.version);

  const functionsConsumer = new ethers.Contract(
    consumerAddress,
    functionsConsumerAbi,
    signer
  );

  // To simulate the call and get the requestId.
  const requestId = await functionsConsumer.callStatic.sendRequest(
    source, // source
    "0x", // user hosted secrets - encryptedSecretsUrls - empty in this example
    slotIdNumber, // don hosted secrets - slot ID - empty in this example
    donHostedSecretsVersion, // don hosted secrets - version - empty in this example
    args,
    [], // bytesArgs - arguments can be encoded off-chain to bytes.
    subscriptionId,
    gasLimit,
    ethers.utils.formatBytes32String(donId) // jobId is bytes32 representation of donId
  );

  // Actual transaction call
  const transaction = await functionsConsumer.sendRequest(
    source, // source
    "0x", // user hosted secrets - encryptedSecretsUrls - empty in this example
    0, // don hosted secrets - slot ID - empty in this example
    donHostedSecretsVersion, // don hosted secrets - version - empty in this example
    args,
    [], // bytesArgs - arguments can be encoded off-chain to bytes.
    subscriptionId,
    gasLimit,
    ethers.utils.formatBytes32String(donId) // jobId is bytes32 representation of donId
  );

  // Log transaction details
  console.log(
    `\n✅ Functions request sent! Transaction hash ${transaction.hash} -  Request id is ${requestId}. Waiting for a response...`
  );

  console.log(
    `See your request in the explorer ${explorerUrl}/tx/${transaction.hash}`
  );

  const responseListener = new ResponseListener({
    provider: provider,
    functionsRouterAddress: routerAddress,
  }); // Instantiate a ResponseListener object to wait for fulfillment.
  (async () => {
    try {
      const response = await new Promise((resolve, reject) => {
        responseListener
          .listenForResponse(requestId)
          .then((response) => {
            resolve(response); // Resolves once the request has been fulfilled.
          })
          .catch((error) => {
            reject(error); // Indicate that an error occurred while waiting for fulfillment.
          });
      });

      const fulfillmentCode = response.fulfillmentCode;

      if (fulfillmentCode === FulfillmentCode.FULFILLED) {
        console.log(
          `\n✅ Request ${requestId} successfully fulfilled. Cost is ${ethers.utils.formatEther(
            response.totalCostInJuels
          )} LINK.Complete reponse: `,
          response
        );
      } else if (fulfillmentCode === FulfillmentCode.USER_CALLBACK_ERROR) {
        console.log(
          `\n⚠️ Request ${requestId} fulfilled. However, the consumer contract callback failed. Cost is ${ethers.utils.formatEther(
            response.totalCostInJuels
          )} LINK.Complete reponse: `,
          response
        );
      } else {
        console.log(
          `\n❌ Request ${requestId} not fulfilled. Code: ${fulfillmentCode}. Cost is ${ethers.utils.formatEther(
            response.totalCostInJuels
          )} LINK.Complete reponse: `,
          response
        );
      }

      const errorString = response.errorString;
      if (errorString) {
        console.log(`\n❌ Error during the execution: `, errorString);
      } else {
        const responseBytesHexstring = response.responseBytesHexstring;
        if (ethers.utils.arrayify(responseBytesHexstring).length > 0) {
          const decodedResponse = decodeResult(
            response.responseBytesHexstring,
            ReturnType.int256
          );
          console.log(
            `\n✅ Decoded response to ${ReturnType.int256}: `,
            decodedResponse
          );
        }
      }
    } catch (error) {
      console.error("Error listening for response:", error);
    }
  })();
};

makeRequestMumbai().catch((e) => {
  console.error(e);
  process.exit(1);
});
