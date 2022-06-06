const express = require('express');
const jwt = require('jsonwebtoken');//require jwt
const { MongoClient } = require('mongodb');
require('dotenv').config();
const cors = require('cors');
const app = express();
const port = process.env.PORT || 5000;
const ObjectId = require('mongodb').ObjectId;
const stripe = require("stripe")('sk_test_5eTBwJOL9RF8QwpGL7pCNh5B00uUc9UUyi');
//middleware
app.use(cors());
app.use(express.json());

// //verify token
const verifyJWT = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send({ message: 'Unauthorized access' });
    }
    const token = authHeader.split(' ')[1];//split token from authHeader
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
            return res.status(403).send({ message: 'Forbidden access' });
        }
        req.decoded = decoded;
        next();
    })
}

//DB access
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.74f46.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });

//api function
async function run() {
    try {
        await client.connect();
        const database = client.db("manufacturer");
        const partsCollection = database.collection("parts");
        const usersCollection = database.collection("users");
        const ordersCollection = database.collection("orders");
        const paymentsCollection = database.collection("payments");
        const reviewsCollection = database.collection("reviews");
        //verify if admin
        const verifyAdmin = async (req, res, next) => {
            const requester = req.decoded.email;
            const requesterAccount = await usersCollection.findOne({ email: requester });
            if (requesterAccount.role === 'admin') {
                next();
            }
            else {
                res.status(403).send({ message: 'Forbidden' });
            }
        }
        //find all parts
        app.get('/parts', async (req, res) => {
            const parts = await partsCollection.find({}).toArray();
            res.json(parts);
        });
        //get single parts
        app.get('/parts/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const singleParts = await partsCollection.findOne(query);
            res.send(singleParts);
        })
        //Inserting parts
        app.post('/add-parts', verifyJWT, verifyAdmin, async (req, res) => {
            const doctor = req.body;
            const result = await partsCollection.insertOne(doctor);
            res.json(result);
        });
        //delete a parts
        app.delete('/parts/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            console.log(id);
            const query = { _id: ObjectId(id) };
            const result = await partsCollection.deleteOne(query);
            res.json(result);
        });
        //Inserting order 
        app.post('/order', verifyJWT, async (req, res) => {
            const order = req.body;
            const filter = { _id: ObjectId(order.partsId) };
            const result = await ordersCollection.insertOne(order);
            //updating quantity of the ordered parts
            const singleParts = await partsCollection.findOne(filter);
            const remainQuantity = singleParts.quantity - order.quantity;
            const option = { upsert: false };
            const updateDoc = {
                $set: { quantity: remainQuantity }
            }
            console.log(updateDoc, order.quantity);
            await partsCollection.updateOne(filter, updateDoc, option);
            res.json(result);
        });
        //find all orders
        app.get('/all-orders', verifyJWT, async (req, res) => {
            const orders = await ordersCollection.find({}).toArray();
            res.json(orders);
        });
        //find user specific orders or all orders
        app.get('/orders', verifyJWT, async (req, res) => {
            const email = req.query.email;
            const decodedEmail = req.decoded.email;
            if (email === decodedEmail) {
                const query = email ? { email: email } : {};//run query for specific user or return all
                const orders = await ordersCollection.find(query).toArray();
                res.json(orders);
            }
            else {
                return res.status(403).send({ message: 'Forbidden access' });
            }

        });
        //delete a order
        app.delete('/order/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const result = await ordersCollection.deleteOne(query);
            res.json(result);
        });

        //get single order to make payment
        app.get('/payment/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const order = await ordersCollection.findOne(query);
            res.send(order);
        })
        //process payment
        app.post("/create-payment-intent", verifyJWT, async (req, res) => {
            const price = req.body.price;
            const amount = price * 100;
            // Create a PaymentIntent with the order amount and currency
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: "usd",
                payment_method_types: ['card']
            });
            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        });
        //update order info with transaction id when payment done
        app.patch('/order/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const payment = req.body;
            const query = { _id: ObjectId(id) };
            const updateDoc = {
                $set: {
                    status: 'pending',
                    transactionId: payment.transactionId,
                }
            }
            const result = await paymentsCollection.insertOne(payment);
            const updatedBooking = await ordersCollection.updateOne(query, updateDoc);
            res.send(updatedBooking);
        });
         //update order status to shipped once admin ship it
         app.patch('/order-shipment/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const updateDoc = {
                $set: {
                    status: 'shipped',
                }
            }
            const updatedBooking = await ordersCollection.updateOne(query, updateDoc);
            res.send(updatedBooking);
        });
        //Inserting review 
        app.post('/review', verifyJWT, async (req, res) => {
            const review = req.body;
            const result = await reviewsCollection.insertOne(review);
            res.json(result);
        });
        //find all reviews
        app.get('/reviews', async (req, res) => {
            const reviews = await reviewsCollection.find({}).toArray();
            res.json(reviews);
        });

        //find all users
        app.get('/users', verifyJWT, async (req, res) => {
            const users = await usersCollection.find({}).toArray();
            res.json(users);
        });
        //find current user
        app.get('/user/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;
            const user = await usersCollection.findOne({ email: email });
            res.send(user);
        });
        //update current user
        app.patch('/user/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;
            const updatedUser = req.body;
            const query = { email: email };
            const updateDoc = {
                $set: updatedUser
            }
            const result = await usersCollection.updateOne(query, updateDoc);
            res.send(result);
        });
        //check if admin
        app.get('/admin/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;
            const user = await usersCollection.findOne({ email: email });
            isAdmin = user.role === 'admin';
            res.send({ admin: isAdmin });;
        });
        //make user admin
        app.put('/user/admin/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const filter = { email: email };
            const updateDoc = {
                $set: { role: 'admin' }
            };
            const result = await usersCollection.updateOne(filter, updateDoc);
            res.send(result);
            console.log(result);
        })

        //create user token and upsert to database when login/register
        app.put('/user/:email', async (req, res) => {
            const email = req.params.email;
            const user = req.body;
            const filter = { email: email };
            const option = { upsert: true };
            const updateDoc = {
                $set: user
            }
            const result = await usersCollection.updateOne(filter, updateDoc, option);
            const token = jwt.sign({ email: email }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1d' });
            res.send({ result, token });
        })

    }
    finally {
        // await client.close();
    }

}
run().catch(console.dir);

//default route
app.get('/', (req, res) => {
    res.send('Running Manufacturing server');
});
app.listen(port, () => {
    console.log('running on Manufacturing server', port);
});