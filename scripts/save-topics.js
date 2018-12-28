const readline = require('readline');
const fs = require('fs');

var OldTopics   = artifacts.require("./MenloTopics.sol");
var MenloTopics = artifacts.require("./NewTopics.sol");

module.exports = function() {
    go()
}

async function go() {
    const FILENAME = 'topics.out'

    fs.writeFileSync(FILENAME, '', (err) => {
        if (err) throw err;
    });

    try {
        let oldTopics = await OldTopics.at(OldTopics.address)
      //  let _topics    = await MenloTopics.at(MenloTopics.address)

        console.log('Reading old _topics')

        let cost = (await oldTopics.topicCost()).toNumber() / 10 ** 18
        console.log('Topics @ ', OldTopics.address)
        console.log('Cost: ', cost)

        oldTopics.NewTopic({}, { fromBlock: 0 }).watch((error, result) => {
            if (error) {
                console.error('Got error watching Topics ', error)
            }

            const forum = result.args._forum
            console.log('Found forum @ ', forum)

            fs.appendFileSync(FILENAME, `${forum}\n`, (err) => {
                if (err) throw err;
            });
        })

    } catch (e) {
        throw(e)
    }
}
