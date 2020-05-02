const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const users = require('../db/entity/users');
const systemCache = require('../db/cache/cache');

/**
 * Cache key prefix for user profile storage.
 * @type {string}
 */
const USER_KEY_PREFIX = 'user:';

/**
 * How long to store the user's profile in Redis (seconds) before we will ask Mongo for it again.
 * @type {number}
 */
const USER_CACHE_EXPIRE_TIME = 60 * 30; // 30 minutes

/**
 * Load the given user from either the cache or the Mongo database. If not cached, cache them.
 * @param id
 * @returns {Promise<{}|null>}
 */
async function loadUser(id) {
    const cachedUser = await systemCache.get(USER_KEY_PREFIX + id);
    if (cachedUser) {
        return JSON.parse(cachedUser);
    } else {
        const user = await users.findUserById(id);
        const userData = {};
        userData.id = user._id;
        userData.username = user.username;

        // Cache user profile if registered with a username.
        if (userData.username) {
            await systemCache.set(USER_KEY_PREFIX + id, JSON.stringify(userData),
                USER_CACHE_EXPIRE_TIME);
        }

        return userData;
    }

    // Nothing found. Bad session.
    return null;
}

/**
 * Setup Google strategy for passport.js and callback function
 */
passport.use(
    new GoogleStrategy({
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_REDIRECT_URL
    }, (accessToken, refreshToken, content, callback) => {
        const userInfo = content['_json'];
        const googleId = userInfo['sub'];
        const email = userInfo['email'];

        // Is it a new user, or an existing one?
        users.findUserByGoogleId(googleId)
            .then((existingUser) => {
                if(existingUser) {
                    callback(null, existingUser);
                } else {
                    // Create a new user.
                    users.saveUser(googleId, email)
                        .then((newUser) => {
                            callback(null, newUser)
                        })
                        .catch((err) => {
                            callback(err);
                        });
                }
            })
            .catch((err) => {
                callback(err);
            });
    })
);

/**
 * Serialize user function - we turn the user into their Mongo database ID.
 */
passport.serializeUser(function(user, callback) {
    if (user && typeof user._id !== 'undefined') {
        callback(null, user._id);
    } else {
        callback(null, null);
    }
});

/**
 * Deserialize user function - grabs the user from the database in Mongo.
 */
passport.deserializeUser(function(id, callback) {
    // Make sure the serialized user is a string and not something strange
    if (typeof id !== 'string') { callback(null, null); }

    loadUser(id)
        .then((userData) => {
            callback(null, userData);
        })
        .catch((err) => {
            callback(err);
        });
});

module.exports = passport;